import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings, tag
from django.urls import reverse

from customers.models import Customer
from orders.models import Order, OrderItem
from production.models import ProductionJob

from .models import Product
from .utils import create_dummy_product
from .forms import ProductForm

@tag("normal")
class ProductTests(TestCase):
    # Test category: normal. Product model.
    def setUp(self):
        """
        First object
        """
        Product.objects.create(
            name = "Test product unit test",
            short_description = "A product that is created in the unit test test_create_product() at /products/test.py.",
            price = 40.0,
            product_type = Product.ProductType.STANDARD,
        )
        

    def test_get_object(self):
        """
        Tests getting an object by primary key from the database.
        """
        test_product = Product.objects.get(pk=1)
        self.assertEqual(test_product.name, "Test product unit test")

@tag("not-critical")
class ProductCreate(TestCase):
    # Test category: not-critical. Debug helper create_dummy_product, only used with DEBUG on.
    # create product with expected fields
    def test_prouct_creation(self):
        product = create_dummy_product()

        # create_dummy_product() makes a custom stamp product (see products/utils.py).
        self.assertEqual(product.name, "Stamp_Dummy2")
        self.assertEqual(product.price, Decimal("10.00"))
        self.assertEqual(product.product_type, Product.ProductType.CUSTOM_STAMP)
        self.assertEqual(Product.objects.count(), 1)

    # call dummy product creation twice to return same output
    def test_calling_twice(self):
        frst = create_dummy_product()
        snd = create_dummy_product()

        self.assertEqual(frst.pk, snd.pk)
        self.assertEqual(Product.objects.count(), 1)

@tag("normal")
class ProductFormTests(TestCase):
    # Test category: normal. Staff form for adding and editing products.
    def valid_data(self, **changes):
        data = {
            "name": "Heart Stamp",
            "price": "8.50",
            "product_type": Product.ProductType.STANDARD
        }
        data.update(changes)

        return data

    def test_valid_product_without_file(self):
        form = ProductForm(data = self.valid_data())
        self.assertTrue(form.is_valid(), form.errors)

    def test_stl_file_is_accepted(self):
        stl_file = SimpleUploadedFile("teststamp.stl", b"solid stamp")
        form = ProductForm(data=self.valid_data(), files={"file": stl_file})

        self.assertTrue(form.is_valid(), form.errors)
        

    def test_uppercase_stl_is_accepted(self):
        stl_file = SimpleUploadedFile("TESTSTAMP.STL", b"solid stamp")
        form = ProductForm(data=self.valid_data(), files={"file": stl_file})

        self.assertTrue(form.is_valid(), form.errors)

    def test_reject_other_file_form(self):
        png_file = SimpleUploadedFile("teststamp.png", b"image")
        form = ProductForm(data=self.valid_data(), files={"file": png_file})

        self.assertFalse(form.is_valid(), form.errors)
        self.assertIn("file", form.errors)

    def test_name_is_required(self):
        form = ProductForm(data=self.valid_data(name=""))

        self.assertFalse(form.is_valid())
        self.assertIn("name", form.errors)

    def test_price_is_required(self):
        form = ProductForm(data=self.valid_data(price=""))

        self.assertFalse(form.is_valid())
        self.assertIn("price", form.errors)


Type = Product.ProductType


class StaffProductMixin:
    """A logged-in staff member, a standard and a custom product, and a temporary media folder."""

    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        override = override_settings(MEDIA_ROOT=media.name)
        override.enable()
        self.addCleanup(override.disable)

        self.staff = get_user_model().objects.create_user("staff", is_staff=True)
        self.client.force_login(self.staff)
        self.mug = Product.objects.create(name="Mug stamp", price=Decimal("5.00"), stock=3, on_website=True)
        self.custom = Product.objects.create(name="Custom stamp", price=Decimal("8.50"), product_type=Type.CUSTOM_STAMP)

    def url(self, name, product=None):
        return reverse(f"products:{name}", args=[product.pk] if product else [])

    def post(self, name, product, data=None):
        return self.client.post(self.url(name, product), data or {})

    def form_data(self, **changes):
        data = {"name": "Heart stamp", "price": "8.50", "product_type": Type.STANDARD}
        data.update(changes)
        return data

    def stock(self):
        self.mug.refresh_from_db()
        return self.mug.stock


@tag("critical")
class ProductPermissionTests(StaffProductMixin, TestCase):
    # Test category: critical. Only staff may see or change products and stock.

    def test_visitors_and_customers_are_sent_to_login(self):
        requests = [
            ("get", self.url("index")),
            ("get", self.url("add")),
            ("get", self.url("product", self.mug)),
            ("get", self.url("edit", self.mug)),
            ("get", self.url("download_stl", self.mug)),
            ("post", self.url("delete", self.mug)),
            ("post", self.url("adjust_stock", self.mug)),
            ("post", self.url("add_to_production", self.mug)),
        ]
        customer = get_user_model().objects.create_user("customer")

        for login in [None, customer]:
            self.client.logout()
            if login:
                self.client.force_login(login)
            for method, url in requests:
                with self.subTest(user=login, url=url):
                    response = getattr(self.client, method)(url, {"action": "increase", "quantity": 5})
                    self.assertEqual(response.status_code, 302)
                    self.assertTrue(response.url.startswith(reverse("admin:login")), response.url)

        self.assertTrue(Product.objects.filter(pk=self.mug.pk).exists())
        self.assertEqual(self.stock(), 3)
        self.assertFalse(ProductionJob.objects.exists())

    def test_actions_only_accept_post(self):
        for name in ["delete", "adjust_stock", "add_to_production"]:
            with self.subTest(view=name):
                self.assertEqual(self.client.get(self.url(name, self.mug)).status_code, 405)


@tag("critical")
class ProductListTests(StaffProductMixin, TestCase):
    # Test category: critical. Staff find products by name, type and visibility.

    def listed(self, **params):
        response = self.client.get(self.url("index"), params)
        self.assertEqual(response.status_code, 200)
        return list(response.context["products"])

    def test_lists_products_by_name(self):
        self.assertEqual(self.listed(), [self.custom, self.mug])

    def test_shows_what_is_in_production(self):
        ProductionJob.objects.create(product=self.mug, quantity=4)
        ProductionJob.objects.create(product=self.mug, quantity=2, status=ProductionJob.ProductionStatus.PRINTING)
        ProductionJob.objects.create(product=self.mug, quantity=9, status=ProductionJob.ProductionStatus.COMPLETED)

        products = {product.pk: product for product in self.listed()}

        self.assertEqual(products[self.mug.pk].in_production, 6)
        self.assertEqual(products[self.custom.pk].in_production, 0)

    def test_searches_by_name(self):
        self.assertEqual(self.listed(search="  MUG "), [self.mug])

    def test_filters_by_type(self):
        self.assertEqual(self.listed(type=Type.CUSTOM_STAMP), [self.custom])
        self.assertEqual(len(self.listed(type="nonsense")), 2)

    def test_filters_by_visibility(self):
        self.assertEqual(self.listed(visibility="visible"), [self.mug])
        self.assertEqual(self.listed(visibility="hidden"), [self.custom])

    def test_product_page_shows_the_units_ordered(self):
        add_order_item(self.mug, quantity=4)

        response = self.client.get(self.url("product", self.mug))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["product"], self.mug)
        self.assertEqual(response.context["total_units_ordered"], 4)

    def test_unknown_product_is_not_found(self):
        response = self.client.get(reverse("products:product", args=[9999]))

        self.assertEqual(response.status_code, 404)


@tag("critical")
class ProductAddEditDeleteTests(StaffProductMixin, TestCase):
    # Test category: critical. Adding, changing and deleting products.

    def test_add_page_shows_the_form(self):
        response = self.client.get(self.url("add"))

        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.context["form"], ProductForm)

    def test_valid_product_is_added(self):
        data = self.form_data(file=SimpleUploadedFile("heart.stl", b"solid heart"))

        response = self.client.post(self.url("add"), data)

        self.assertRedirects(response, self.url("index"))
        product = Product.objects.get(name="Heart stamp")
        self.assertEqual(product.price, Decimal("8.50"))
        self.assertTrue(product.file.name.endswith(".stl"))

    def test_invalid_product_is_not_added(self):
        data = self.form_data(file=SimpleUploadedFile("heart.png", b"image"))

        response = self.client.post(self.url("add"), data)

        self.assertEqual(response.status_code, 200)
        self.assertIn("file", response.context["form"].errors)
        self.assertFalse(Product.objects.filter(name="Heart stamp").exists())

    def test_edit_page_shows_the_product(self):
        response = self.client.get(self.url("edit", self.mug))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["form"].instance, self.mug)

    def test_edit_saves_the_changes(self):
        response = self.post("edit", self.mug, self.form_data(name="Big mug stamp", price="6.00"))

        self.assertRedirects(response, self.url("product", self.mug))
        self.mug.refresh_from_db()
        self.assertEqual(self.mug.name, "Big mug stamp")
        self.assertEqual(self.mug.price, Decimal("6.00"))

    def test_invalid_edit_changes_nothing(self):
        response = self.post("edit", self.mug, self.form_data(name=""))

        self.assertEqual(response.status_code, 200)
        self.mug.refresh_from_db()
        self.assertEqual(self.mug.name, "Mug stamp")

    def test_delete_removes_the_product(self):
        response = self.post("delete", self.mug)

        self.assertRedirects(response, self.url("index"))
        self.assertFalse(Product.objects.filter(pk=self.mug.pk).exists())

    def test_products_in_use_cannot_be_deleted(self):
        add_order_item(self.mug)
        ProductionJob.objects.create(product=self.custom)

        for product in [self.mug, self.custom]:
            with self.subTest(product=product.name):
                response = self.post("delete", product)
                self.assertRedirects(response, self.url("edit", product))
                self.assertTrue(Product.objects.filter(pk=product.pk).exists())

    def test_download_gives_the_stl_file(self):
        self.mug.file = SimpleUploadedFile("mug.stl", b"solid mug")
        self.mug.save()

        response = self.client.get(self.url("download_stl", self.mug))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), b"solid mug")
        self.assertIn("attachment", response["Content-Disposition"])
        response.close()

    def test_download_without_a_file_is_not_found(self):
        # Like the order item download: no file means 404, not a server error.
        response = self.client.get(self.url("download_stl", self.mug))

        self.assertEqual(response.status_code, 404)


@tag("critical")
class ProductStockTests(StaffProductMixin, TestCase):
    # Test category: critical. Changing stock by hand and sending products to production.

    def test_increase_adds_one(self):
        response = self.post("adjust_stock", self.mug, {"action": "increase"})

        self.assertRedirects(response, self.url("product", self.mug))
        self.assertEqual(self.stock(), 4)

    def test_decrease_takes_one(self):
        self.post("adjust_stock", self.mug, {"action": "decrease"})

        self.assertEqual(self.stock(), 2)

    def test_stock_never_goes_below_zero(self):
        Product.objects.filter(pk=self.mug.pk).update(stock=0)

        self.post("adjust_stock", self.mug, {"action": "decrease"})

        self.assertEqual(self.stock(), 0)

    def test_unknown_action_changes_nothing(self):
        for data in [{"action": "double"}, {}]:
            with self.subTest(data=data):
                self.post("adjust_stock", self.mug, data)
                self.assertEqual(self.stock(), 3)

    def test_custom_stamps_have_no_stock(self):
        self.post("adjust_stock", self.custom, {"action": "increase"})

        self.custom.refresh_from_db()
        self.assertEqual(self.custom.stock, 0)

    def test_add_to_production_creates_a_job(self):
        response = self.post("add_to_production", self.mug, {"quantity": "5"})

        self.assertRedirects(response, self.url("product", self.mug))
        job = ProductionJob.objects.get()
        self.assertEqual((job.product, job.quantity, job.order_item), (self.mug, 5, None))

    def test_add_to_production_defaults_to_one(self):
        self.post("add_to_production", self.mug)

        self.assertEqual(ProductionJob.objects.get().quantity, 1)

    def test_add_to_production_refuses_bad_quantities(self):
        for quantity in ["abc", "0", "-2", ""]:
            with self.subTest(quantity=quantity):
                self.post("add_to_production", self.mug, {"quantity": quantity})
                self.assertFalse(ProductionJob.objects.exists())

    def test_custom_stamps_are_not_produced_for_stock(self):
        self.post("add_to_production", self.custom, {"quantity": "5"})

        self.assertFalse(ProductionJob.objects.exists())

    def test_unknown_product_is_not_found(self):
        missing = Product(pk=9999)
        for name in ["edit", "delete", "adjust_stock", "add_to_production", "download_stl"]:
            with self.subTest(view=name):
                method = self.client.get if name in ("edit", "download_stl") else self.client.post
                self.assertEqual(method(self.url(name, missing)).status_code, 404)


def add_order_item(product, quantity=1):
    """Puts the product in an order, so it is in use."""
    customer = Customer.objects.create(first_name="Anna", last_name="Jansen", email="anna@example.nl")
    order = Order.objects.create(
        customer=customer,
        subtotal_price=Decimal("10.00"),
        shipping_costs=Decimal("5.00"),
        total_price=Decimal("15.00"),
    )
    return OrderItem.objects.create(
        order=order, product=product, name=product.name, quantity=quantity, unit_price=product.price
    )
