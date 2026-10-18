from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.utils import timezone

from customers.models import Customer
from orders.models import Order, OrderItem
from production.models import ProductionJob
from products.models import Product

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.messages.storage.fallback import FallbackStorage
from django.test import RequestFactory, TestCase, override_settings
from django.urls import resolve, reverse

from orders.views import index


class DashboardShellTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = get_user_model().objects.create_user('shell-staff', is_staff=True)

    def test_orders_navigation_and_mobile_menu_have_accessible_state(self):
        self.client.force_login(self.staff)
        response = self.client.get(reverse('orders:index'))
        self.assertContains(response, '<title>Orders | Clayster</title>', html=True)
        self.assertContains(response, 'href="#main-content"')
        self.assertContains(response, 'aria-controls="sidebar-navigation"')
        self.assertContains(response, 'href="/orders/" aria-current="page"')
        self.assertContains(response, 'aria-label="Order status"')
        self.assertContains(response, 'scope="col"', count=7)
        self.assertNotContains(response, 'href=""')

    def test_error_feedback_is_visible_and_user_text_is_escaped(self):
        request = RequestFactory().get(reverse('orders:index'))
        request.user = self.staff
        request.session = {}
        request.resolver_match = resolve(request.path)
        request._messages = FallbackStorage(request)
        messages.error(request, 'Cannot print <script>alert(1)</script>')
        response = index(request)
        self.assertContains(response, 'alert-danger')
        self.assertContains(response, 'Cannot print &lt;script&gt;alert(1)&lt;/script&gt;')
        self.assertNotContains(response, '<script>alert(1)</script>')


@override_settings(DEBUG=False)
class HomeDashboardTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = get_user_model().objects.create_user('home-staff', is_staff=True)
        cls.customer = Customer.objects.create(
            first_name='A very long customer first name',
            last_name='A long customer family name', email='home@example.com',
        )
        cls.product = Product.objects.create(
            name='Custom clay stamp with a long personalized product name',
            price=Decimal('10.00'), product_type=Product.ProductType.CUSTOM_STAMP,
        )

    def setUp(self):
        self.client.force_login(self.staff)

    def make_order(self, status=Order.OrderStatus.PROCESSING):
        return Order.objects.create(
            customer=self.customer, order_status=status,
            subtotal_price=Decimal('10.00'), shipping_costs=Decimal('4.95'),
            total_price=Decimal('14.95'),
        )

    def make_item(self, order, ready=False):
        return OrderItem.objects.create(
            order=order, product=self.product, name='Personalized stamp',
            quantity=3, unit_price=Decimal('10.00'), is_ready=ready,
        )

    def make_job(self, status, item=None, quantity=3):
        return ProductionJob.objects.create(
            product=self.product, order_item=item, quantity=quantity, status=status,
        )

    def test_empty_orders_and_production(self):
        Product.objects.all().delete()
        response = self.client.get(reverse('index'))
        self.assertEqual(response.context['order_counts'], {
            'today': 0, 'open': 0, 'processing': 0, 'ready': 0,
        })
        self.assertEqual(response.context['production_counts'], {
            'waiting': 0, 'printing': 0, 'ready': 0,
        })
        self.assertContains(response, 'All caught up!')
        self.assertContains(response, 'No orders yet')
        self.assertContains(response, 'Nothing is currently printing.')
        self.assertNotContains(response, 'Development tools')

    def test_open_and_ready_counts_use_order_statuses_not_item_or_job_counts(self):
        for status in Order.OrderStatus:
            order = self.make_order(status)
            for ready in (False, True):
                item = self.make_item(order, ready=ready)
                self.make_job(ProductionJob.ProductionStatus.COMPLETED, item=item)
        response = self.client.get(reverse('index'))
        self.assertEqual(response.context['order_counts'], {
            'today': 6, 'open': 3, 'processing': 1, 'ready': 1,
        })
        self.assertEqual(response.context['production_counts']['ready'], 0)
        self.assertContains(response, 'Orders processing')
        self.assertContains(response, 'Orders ready to ship')

    def test_today_uses_amsterdam_midnight_including_dst_boundary(self):
        local_zone = ZoneInfo('Europe/Amsterdam')
        # DST ends on this date: the local day is 25 hours long.
        fixed_now = datetime(2026, 10, 25, 12, tzinfo=local_zone)
        start = datetime(2026, 10, 25, tzinfo=local_zone)
        end = datetime(2026, 10, 26, tzinfo=local_zone)
        for when in (start - timedelta(seconds=1), start, end - timedelta(seconds=1), end):
            order = self.make_order()
            Order.objects.filter(pk=order.pk).update(created_at=when)
        with timezone.override(local_zone), patch('django.utils.timezone.now', return_value=fixed_now):
            response = self.client.get(reverse('index'))
        self.assertEqual(response.context['order_counts']['today'], 2)

    def test_stages_count_jobs_rather_than_quantities_and_preserve_partial_work(self):
        item = self.make_item(self.make_order())
        stage = ProductionJob.ProductionStatus
        for state in stage:
            self.make_job(state, item=item, quantity=20)
        self.make_job(stage.WAITING, quantity=50)
        response = self.client.get(reverse('index'))
        self.assertEqual(response.context['production_counts'], {
            'waiting': 2, 'printing': 1, 'ready': 1,
        })
        self.assertEqual(response.context['order_counts']['processing'], 1)
        self.assertContains(response, self.product.name)
        self.assertContains(response, reverse('orders:order', args=[item.order_id]))
        self.assertContains(response, 'Quantity: 20')

    def test_current_stock_print_has_no_order_link_requirement(self):
        self.make_job(ProductionJob.ProductionStatus.PRINTING)
        response = self.client.get(reverse('index'))
        self.assertContains(response, 'Stock production')

    def test_completed_and_cancelled_work_does_not_create_attention(self):
        for state in (Order.OrderStatus.COMPLETED, Order.OrderStatus.CANCELLED):
            item = self.make_item(self.make_order(state))
            self.make_job(ProductionJob.ProductionStatus.COMPLETED, item)
            self.make_job(ProductionJob.ProductionStatus.CANCELLED, item)
        response = self.client.get(reverse('index'))
        self.assertFalse(response.context['needs_attention'])
        self.assertContains(response, 'All caught up!')
        self.assertNotContains(response, 'Production jobs waiting')

    def test_recent_orders_are_latest_five_with_shared_status_and_existing_links(self):
        orders = [self.make_order(status) for status in Order.OrderStatus]
        response = self.client.get(reverse('index'))
        self.assertEqual([o.pk for o in response.context['recent_orders']], [o.pk for o in orders[::-1][:5]])
        self.assertNotContains(response, reverse('orders:order', args=[orders[0].pk]))
        for order in orders[-5:]:
            self.assertContains(response, reverse('orders:order', args=[order.pk]))
        self.assertContains(response, 'status-badge status-ready')
        self.assertContains(response, self.customer.first_name)
        self.assertContains(response, reverse('orders:index') + '?status=all')
        self.assertContains(response, reverse('orders:index') + '?status=open')
        self.assertContains(response, reverse('production:index'))
        self.assertNotContains(response, '?status=ready')
        self.assertNotContains(response, '?date=today')
        self.assertContains(response, '<title>Dashboard | Clayster</title>', html=True)

    def test_dashboard_requires_staff_access(self):
        self.client.logout()
        self.assertRedirects(self.client.get(reverse('index')), '/admin/login/?next=/dashboard/', fetch_redirect_response=False)
        user = get_user_model().objects.create_user('regular-user')
        self.client.force_login(user)
        self.assertEqual(self.client.get(reverse('index')).status_code, 302)

    @override_settings(DEBUG=True)
    def test_development_tools_are_collapsed_and_only_present_in_debug(self):
        response = self.client.get(reverse('index'))
        self.assertContains(response, '<details class="card mt-4 dashboard-dev-tools">')
        self.assertContains(response, reverse('orders:test_custom_order'))
        self.assertContains(response, reverse('orders:test_standard_order'))

    def test_data_query_count_does_not_grow_with_more_recent_orders(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        self.make_order()
        with CaptureQueriesContext(connection) as first:
            self.client.get(reverse('index'))
        for _ in range(5):
            self.make_order()
        with CaptureQueriesContext(connection) as second:
            self.client.get(reverse('index'))
        self.assertEqual(len(first), len(second))
