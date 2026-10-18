import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from django.urls import reverse

from customers.models import Customer
from orders.models import Order, OrderItem
from products.models import Product

from .models import ProductionJob


class ProductionStlTests(TestCase):
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
