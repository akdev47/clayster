import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings, tag
from django.urls import reverse
from django.utils import timezone

from customers.models import Customer
from orders.models import Order, OrderItem
from products.models import Product

from .forms import ProductionJobForm
from .models import ProductionJob

Status = ProductionJob.ProductionStatus

# The POST views that move a job from one status to another.
ACTIONS = ["start", "ready", "complete", "cancel", "stop"]


@tag("normal")
class ProductionJobFormTests(TestCase):
    # Test category: normal. Staff form for adding production jobs.
    def setUp(self):
        # The form needs a real product to point to
        self.product = Product.objects.create(name="Heart stamp", price="8.50")

    def valid_data(self, **changes):
        data = {
            "product": self.product.pk,
            "quantity": 3,
        }
        data.update(changes)
        return data

    def test_valid_job(self):
        form = ProductionJobForm(data=self.valid_data())

        self.assertTrue(form.is_valid(), form.errors)

    def test_product_is_required(self):
        form = ProductionJobForm(data=self.valid_data(product=""))

        self.assertFalse(form.is_valid())
        self.assertIn("product", form.errors)

    def test_unknown_product_is_rejected(self):
        form = ProductionJobForm(data=self.valid_data(product=9999))

        self.assertFalse(form.is_valid())
        self.assertIn("product", form.errors)

    def test_negative_quantity_is_rejected(self):
        form = ProductionJobForm(data=self.valid_data(quantity="-109"))

        self.assertFalse(form.is_valid())
        self.assertIn("quantity", form.errors)

class ProductionViewMixin:
    """A product with 2 in stock and a logged-in staff member."""

    def setUp(self):
        self.product = Product.objects.create(name="Heart stamp", price="8.50", stock=2)
        self.staff = get_user_model().objects.create_user("staff", is_staff=True)
        self.client.force_login(self.staff)

    def make_job(self, status=Status.WAITING, quantity=3):
        return ProductionJob.objects.create(product=self.product, quantity=quantity, status=status)

    def post(self, action, job):
        return self.client.post(reverse(f"production:{action}", args=[job.pk]))


@tag("critical")
class ProductionPermissionTests(ProductionViewMixin, TestCase):
    # Test category: critical. Only staff may see or change production jobs.

    def assert_sent_to_login(self, response):
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith(reverse("admin:login")), response.url)

    def assert_refused_everywhere(self):
        self.assert_sent_to_login(self.client.get(reverse("production:index")))
        self.assert_sent_to_login(self.client.get(reverse("production:add")))

        response = self.client.post(reverse("production:add"), {"product": self.product.pk, "quantity": 5})
        self.assert_sent_to_login(response)
        self.assertFalse(ProductionJob.objects.exists())

        for action in ACTIONS:
            # A status the action would change, so a missing check shows up
            status = Status.PRINTING if action in ("ready", "stop") else Status.WAITING
            job = self.make_job(status=status)
            with self.subTest(action=action):
                self.assert_sent_to_login(self.post(action, job))
                job.refresh_from_db()
                self.assertEqual(job.status, status)
            job.delete()

    def test_visitors_are_sent_to_login(self):
        self.client.logout()
        self.assert_refused_everywhere()

    def test_logged_in_customers_are_sent_to_login(self):
        customer = get_user_model().objects.create_user("customer")
        self.client.force_login(customer)
        self.assert_refused_everywhere()


@tag("critical")
class ProductionIndexAndAddTests(ProductionViewMixin, TestCase):
    # Test category: critical. The production overview and adding jobs by hand.

    def test_staff_see_the_jobs_by_status(self):
        printing = self.make_job(status=Status.PRINTING)
        waiting = self.make_job()
        ready = self.make_job(status=Status.READY)

        response = self.client.get(reverse("production:index"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["current_job"], printing)
        self.assertEqual(list(response.context["waiting_jobs"]), [waiting])
        self.assertEqual(list(response.context["ready_jobs"]), [ready])

    def test_add_page_shows_the_form(self):
        response = self.client.get(reverse("production:add"))

        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.context["form"], ProductionJobForm)

    def test_valid_job_is_added(self):
        response = self.client.post(reverse("production:add"), {"product": self.product.pk, "quantity": 5})

        self.assertRedirects(response, reverse("production:index"))
        job = ProductionJob.objects.get()
        self.assertEqual(job.quantity, 5)
        self.assertEqual(job.status, Status.WAITING)

    def test_invalid_job_is_not_added(self):
        response = self.client.post(reverse("production:add"), {"product": self.product.pk, "quantity": -1})

        self.assertEqual(response.status_code, 200)
        self.assertIn("quantity", response.context["form"].errors)
        self.assertFalse(ProductionJob.objects.exists())


@tag("critical")
class ProductionStatusTests(ProductionViewMixin, TestCase):
    # Test category: critical. Moving a job through its statuses; completing one adds stock.

    def test_start_prints_a_waiting_job(self):
        job = self.make_job()

        self.assertRedirects(self.post("start", job), reverse("production:index"))

        job.refresh_from_db()
        self.assertEqual(job.status, Status.PRINTING)
        self.assertIsNotNone(job.started_at)

    def test_only_one_job_prints_at_a_time(self):
        self.make_job(status=Status.PRINTING)
        job = self.make_job()

        self.post("start", job)

        job.refresh_from_db()
        self.assertEqual(job.status, Status.WAITING)
        self.assertIsNone(job.started_at)

    def test_ready_marks_a_printing_job_ready(self):
        job = self.make_job(status=Status.PRINTING)

        self.post("ready", job)

        job.refresh_from_db()
        self.assertEqual(job.status, Status.READY)

    def test_ready_ignores_a_job_that_is_not_printing(self):
        job = self.make_job()

        self.post("ready", job)

        job.refresh_from_db()
        self.assertEqual(job.status, Status.WAITING)

    def test_complete_adds_the_quantity_to_stock(self):
        job = self.make_job(status=Status.READY, quantity=3)

        self.post("complete", job)

        job.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(job.status, Status.COMPLETED)
        self.assertIsNotNone(job.completed_at)
        self.assertEqual(self.product.stock, 5)

    def test_complete_ignores_a_job_that_is_not_ready(self):
        job = self.make_job(status=Status.PRINTING)

        self.post("complete", job)

        job.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(job.status, Status.PRINTING)
        self.assertEqual(self.product.stock, 2)

    def test_completing_twice_adds_stock_once(self):
        job = self.make_job(status=Status.READY, quantity=3)

        self.post("complete", job)
        self.post("complete", job)

        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 5)

    def test_cancel_stops_unfinished_jobs(self):
        for status in [Status.WAITING, Status.PRINTING, Status.READY]:
            job = self.make_job(status=status)
            with self.subTest(status=status):
                self.post("cancel", job)
                job.refresh_from_db()
                self.assertEqual(job.status, Status.CANCELLED)

    def test_cancel_leaves_a_completed_job_alone(self):
        job = self.make_job(status=Status.COMPLETED)

        self.post("cancel", job)

        job.refresh_from_db()
        self.assertEqual(job.status, Status.COMPLETED)

    def test_stop_puts_a_printing_job_back_in_the_queue(self):
        job = self.make_job(status=Status.PRINTING)
        job.started_at = timezone.now()
        job.save()

        self.post("stop", job)

        job.refresh_from_db()
        self.assertEqual(job.status, Status.WAITING)
        self.assertIsNone(job.started_at)

    def test_stop_ignores_a_job_that_is_not_printing(self):
        job = self.make_job(status=Status.READY)

        self.post("stop", job)

        job.refresh_from_db()
        self.assertEqual(job.status, Status.READY)

    def test_actions_only_accept_post(self):
        job = self.make_job()
        for action in ACTIONS:
            with self.subTest(action=action):
                response = self.client.get(reverse(f"production:{action}", args=[job.pk]))
                self.assertEqual(response.status_code, 405)

    def test_unknown_job_is_not_found(self):
        for action in ACTIONS:
            with self.subTest(action=action):
                response = self.client.post(reverse(f"production:{action}", args=[9999]))
                self.assertEqual(response.status_code, 404)



@tag("critical")
class ProductionStlTests(TestCase):
    # Test category: critical. Each job downloads its own STL file, staff only.
    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings = override_settings(MEDIA_ROOT=media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.staff = get_user_model().objects.create_user("printer", is_staff=True)
        self.client.force_login(self.staff)
        self.product = Product.objects.create(
            name="Custom clay stamp", price=Decimal("10.00"),
            product_type=Product.ProductType.CUSTOM_STAMP,
        )
        self.product.file.save("generic.stl", ContentFile(b"generic"))
        self.customer = Customer.objects.create(
            first_name="Test", last_name="Customer", email="test@example.com"
        )

    def make_job(self, data=None, status=ProductionJob.ProductionStatus.WAITING):
        order = Order.objects.create(
            customer=self.customer, subtotal_price=10, shipping_costs=5, total_price=15
        )
        item = OrderItem.objects.create(
            order=order, product=self.product, name="Personal stamp", unit_price=10
        )
        if data is not None:
            item.stl_file.save("stamp.stl", ContentFile(data))
        return ProductionJob.objects.create(product=self.product, order_item=item, status=status)

    def test_shared_product_jobs_download_their_own_files(self):
        first = self.make_job(b"first design")
        second = self.make_job(b"second design")
        self.assertEqual(first.product_id, second.product_id)
        self.assertNotEqual(first.stl_download_url, second.stl_download_url)
        for job, expected in [(first, b"first design"), (second, b"second design")]:
            response = self.client.get(job.stl_download_url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(b"".join(response.streaming_content), expected)
            response.close()

    def test_custom_item_without_file_never_uses_generic_file(self):
        job = self.make_job()
        self.assertIsNone(job.stl_file)
        self.assertIsNone(job.stl_download_url)
        response = self.client.get(reverse("production:index"))
        self.assertNotContains(response, "Download STL")

    def test_standard_item_override_and_product_fallback(self):
        self.product.product_type = Product.ProductType.STANDARD
        self.product.save()
        override = self.make_job(b"order override")
        fallback = self.make_job()
        self.assertEqual(override.stl_file.name, override.order_item.stl_file.name)
        self.assertEqual(override.stl_download_url, reverse("orders:download_item_stl", args=[override.order_item_id]))
        self.assertEqual(fallback.stl_file.name, self.product.file.name)
        self.assertEqual(fallback.stl_download_url, reverse("products:download_stl", args=[self.product.pk]))

    def test_job_without_order_uses_product_file_or_has_no_download(self):
        job = ProductionJob.objects.create(product=self.product)
        self.assertEqual(job.stl_file.name, self.product.file.name)
        self.assertEqual(job.stl_download_url, reverse("products:download_stl", args=[self.product.pk]))
        self.product.file = ""
        self.product.save()
        job = ProductionJob.objects.get(pk=job.pk)
        self.assertIsNone(job.stl_file)
        self.assertIsNone(job.stl_download_url)

    def test_download_buttons_in_every_production_section(self):
        jobs = [self.make_job(b"stamp", status) for status in (
            ProductionJob.ProductionStatus.PRINTING,
            ProductionJob.ProductionStatus.WAITING,
            ProductionJob.ProductionStatus.READY,
            ProductionJob.ProductionStatus.COMPLETED,
        )]
        response = self.client.get(reverse("production:index"))
        self.assertContains(response, "Download STL", count=4)
        for job in jobs:
            self.assertContains(response, job.stl_download_url)
        self.assertNotContains(response, reverse("products:download_stl", args=[self.product.pk]))

    def test_both_download_endpoints_require_staff(self):
        job = self.make_job(b"private")
        urls = [job.stl_download_url, reverse("products:download_stl", args=[self.product.pk])]
        self.client.logout()
        for url in urls:
            self.assertRedirects(self.client.get(url), f"/admin/login/?next={url}", fetch_redirect_response=False)
        user = get_user_model().objects.create_user("customer")
        self.client.force_login(user)
        for url in urls:
            self.assertEqual(self.client.get(url).status_code, 302)

    def test_missing_files_return_404(self):
        job = self.make_job()
        item_url = reverse("orders:download_item_stl", args=[job.order_item_id])
        self.assertEqual(self.client.get(item_url).status_code, 404)
        job.order_item.stl_file = "stl/missing.stl"
        job.order_item.save()
        self.assertEqual(self.client.get(item_url).status_code, 404)
        product_url = reverse("products:download_stl", args=[self.product.pk])
        self.product.file = ""
        self.product.save()
        self.assertEqual(self.client.get(product_url).status_code, 404)
        self.product.file = "stl-files/missing.stl"
        self.product.save()
        self.assertEqual(self.client.get(product_url).status_code, 404)
