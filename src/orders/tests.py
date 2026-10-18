import json
import re
import struct
import tempfile
from decimal import Decimal
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils.formats import number_format

from customers.models import Customer
from production.models import ProductionJob
from products.models import Product
from products.utils import CUSTOM_STAMP_PRODUCT_NAME, get_custom_stamp_product

from . import pricing
from .models import Order, OrderItem, Payment
from .pricing import PricingError, estimate_price
from .stl import StlError, extents_match, read_stl

DATA = Path(__file__).resolve().parent / "test_data"


def money(amount):
    """An amount the way the pages show it in the site's language (24,95 in Dutch)."""
    return number_format(Decimal(amount), decimal_pos=2)


def binary_stl(triangles):
    """A binary STL with the given triangles, each three (x, y, z) vertices."""
    data = bytearray(80) + struct.pack("<I", len(triangles))
    for a, b, c in triangles:
        data += struct.pack("<12fH", 0, 0, 1, *a, *b, *c, 0)
    return bytes(data)


def real_stamp():
    """A stamp exported by the stamp generator itself, and the measurements it reported."""
    meta = json.loads((DATA / "stamp_info.json").read_text())
    return (DATA / "stamp.stl").read_bytes(), meta["stamp"], meta["info"]


class PricingTests(SimpleTestCase):
    """The shop's price must agree to the cent with the estimate the browser shows."""

    fixture = json.loads((DATA / "pricing_cases.json").read_text())

    def test_the_page_gets_the_browsers_price_list(self):
        self.assertEqual(pricing.pricing_for_page(), self.fixture["pricing"])

    def test_every_shared_case_gives_the_same_price_as_the_browser(self):
        for case in self.fixture["cases"]:
            with self.subTest(case["name"]):
                price = estimate_price(
                    case["stamp"], case["info"], case["quantity"], case["country"]
                )
                expected = case["expected"]
                self.assertEqual(price["unit_cents"], expected["unitCents"])
                self.assertEqual(price["items_cents"], expected["itemsCents"])
                self.assertEqual(price["discount_cents"], expected["discountCents"])
                self.assertEqual(price["shipping_cents"], expected["shippingCents"])
                self.assertEqual(price["total_cents"], expected["totalCents"])

    def test_cases_from_the_first_python_port(self):
        # Kept from the original pricing tests; the numbers must not change.
        knob = {"faceShape": "square", "faceSize": 40, "handle": "knob"}
        plain = {"faceShape": "square", "faceSize": 40, "handle": "none"}
        cases = [
            ("square with a handle, no measurements", knob, None, 1, "NL", "total_cents", 1741),
            ("round without handle, Belgium", {**plain, "faceShape": "round"}, None, 1, "BE", "total_cents", 1620),
            ("discount and free shipping", {**knob, "faceSize": 30}, None, 10, "DE", "total_cents", 10836),
            ("unknown country uses the other zone", plain, {"width": 52.5, "depth": 31}, 1, "US", "total_cents", 2243),
            ("rounds half up like JavaScript", plain, {"width": 50, "depth": 15.5}, 1, "NL", "unit_cents", 897),
        ]
        for name, stamp, info, quantity, country, key, expected in cases:
            with self.subTest(name):
                self.assertEqual(estimate_price(stamp, info, quantity, country)[key], expected)

    def test_countries_and_shipping_zones_agree(self):
        zones = set(pricing.PRICING["shipping"]["by_country_cents"])
        self.assertEqual(set(pricing.COUNTRIES), zones)

    def test_bad_input_cannot_be_priced(self):
        stamp = {"faceShape": "square", "faceSize": 50, "handle": "none"}
        for quantity in (0, -1, 1000, 1.5, "2", True, None):
            with self.subTest(quantity=quantity), self.assertRaises(PricingError):
                estimate_price(stamp, None, quantity, "NL")
        for info in ({"width": -5, "depth": 10}, {"width": float("nan"), "depth": 10},
                     {"width": "50", "depth": 10}, {"width": 5000, "depth": 10}):
            with self.subTest(info=info), self.assertRaises(PricingError):
                estimate_price(stamp, info, 1, "NL")
        for stamp_value in (None, [], "square"):
            with self.subTest(stamp=stamp_value), self.assertRaises(PricingError):
                estimate_price(stamp_value, None, 1, "NL")


class StlTests(SimpleTestCase):
    box = [((0, 0, 0), (10, 0, 0), (10, 20, 0)), ((0, 0, 0), (10, 20, 0), (0, 20, 5))]

    def test_reads_the_size_of_a_valid_file(self):
        info = read_stl(binary_stl(self.box))
        self.assertEqual(info.triangles, 2)
        self.assertEqual(info.extents_mm, (10, 20, 5))

    def test_reads_a_file_made_by_the_stamp_generator(self):
        data, _, measured = real_stamp()
        info = read_stl(data)
        self.assertEqual(info.triangles, measured["triangles"])
        self.assertTrue(
            extents_match(info.extents_mm, [measured["width"], measured["depth"], measured["height"]])
        )

    def test_rejects_files_that_are_not_stamps(self):
        valid = binary_stl(self.box)
        bad = {
            "empty": b"",
            "too short": b"x" * 40,
            "ascii stl": b"solid stamp\nendsolid stamp\n" + b" " * 100,
            "no triangles": binary_stl([]),
            "count larger than the data": valid[:80] + struct.pack("<I", 5) + valid[84:],
            "trailing bytes": valid + b"extra",
            "not a number": binary_stl([((float("nan"), 0, 0), (1, 0, 0), (1, 1, 0))]),
            "infinite": binary_stl([((float("inf"), 0, 0), (1, 0, 0), (1, 1, 0))]),
            "enormous": binary_stl([((0, 0, 0), (5000, 0, 0), (0, 5000, 0))]),
        }
        for name, data in bad.items():
            with self.subTest(name), self.assertRaises(StlError):
                read_stl(data)

    def test_size_matches_whichever_way_round_it_is_given(self):
        self.assertTrue(extents_match((10, 20, 5), [5, 10, 20]))
        self.assertTrue(extents_match((10, 20, 5), [5.3, 10, 19.8]))
        self.assertFalse(extents_match((10, 20, 5), [5, 10, 40]))


class MediaTestCase(TestCase):
    """Uploaded files go to a temporary folder, never to the real media folder."""

    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        override = override_settings(MEDIA_ROOT=media.name)
        override.enable()
        self.addCleanup(override.disable)
        self.media_root = Path(media.name)


class OrderMixin:
    endpoint = "orders_api:create_order"

    def payload(self, **changes):
        _, stamp, info = real_stamp()
        payload = {
            "schemaVersion": 2,
            "order": {
                "title": "Bakery logo",
                "description": "Round logo for the bread.",
                "quantity": 2,
                "notes": "Ring the bell twice.",
            },
            "delivery": {
                "firstName": "Jan",
                "lastName": "de Vries",
                "email": "jan@example.nl",
                "phone": "+31 6 12345678",
                "street": "Kerkstraat",
                "houseNumber": "12",
                "houseNumberAddition": "B",
                "postalCode": "1234 ab",
                "city": "Utrecht",
                "country": "NL",
            },
            "priceEstimate": {"totalCents": 1},
            "stamp": stamp,
            "measurements": info,
            "design": [{"id": "text-1", "kind": "text"}],
        }
        payload.update(changes)
        return payload

    def post_order(self, payload=None, stl=None, client=None, name="stamp.stl"):
        data = real_stamp()[0] if stl is None else stl
        return (client or self.client).post(
            reverse(self.endpoint),
            {
                "payload": json.dumps(self.payload() if payload is None else payload),
                "stl": SimpleUploadedFile(name, data, content_type="model/stl"),
            },
        )

    def place_order(self, **changes):
        response = self.post_order(self.payload(**changes) if changes else None)
        self.assertEqual(response.status_code, 201, response.content)
        return Order.objects.latest("pk"), response.json()["payUrl"]


class CreateOrderTests(OrderMixin, MediaTestCase):
    def test_creates_an_order_awaiting_payment(self):
        response = self.post_order()

        self.assertEqual(response.status_code, 201)
        order = Order.objects.get()
        self.assertEqual(response.json(), {"payUrl": f"/order/{order.public_id}/pay/"})
        self.assertEqual(order.order_status, Order.OrderStatus.AWAITING_PAYMENT)
        self.assertEqual(order.delivery_notes, "Ring the bell twice.")
        # 50 x 50 mm: 850 + 25 cm² * 6 = 1000 cents each, 2 pieces, plus 4.95 shipping to NL.
        self.assertEqual(order.subtotal_price, Decimal("20.00"))
        self.assertEqual(order.shipping_costs, Decimal("4.95"))
        self.assertEqual(order.total_price, Decimal("24.95"))

        self.assertEqual(order.customer.first_name, "Jan")
        self.assertEqual(order.customer.last_name, "de Vries")
        self.assertEqual(order.customer.email, "jan@example.nl")
        self.assertEqual(str(order.address), "Kerkstraat 12B")
        self.assertEqual(order.address.postal_code, "1234 AB")
        self.assertEqual(order.address.country, "Netherlands")

        item = order.items.get()
        self.assertEqual(item.display_name, "Bakery logo")
        self.assertEqual(item.description, "Round logo for the bread.")
        self.assertEqual((item.quantity, item.unit_price), (2, Decimal("10.00")))
        self.assertEqual(item.product.product_type, Product.ProductType.CUSTOM_STAMP)
        self.assertEqual(item.design["measurements"]["width"], 50)
        self.assertEqual(item.design["stl"]["triangles"], 288)
        self.assertEqual(item.stl_file.read(), real_stamp()[0])

    def test_nothing_is_paid_or_produced_yet(self):
        self.post_order()
        self.assertFalse(Order.objects.get().is_paid)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(ProductionJob.objects.count(), 0)
        self.assertEqual(mail.outbox, [])

    def test_the_price_comes_from_the_server_not_the_client(self):
        self.post_order(self.payload(priceEstimate={"totalCents": 1, "unitCents": 1}))
        self.assertEqual(Order.objects.get().total_price, Decimal("24.95"))

    def test_the_stored_file_gets_a_random_name(self):
        self.post_order(name="../../evil.stl")
        stored = Path(OrderItem.objects.get().stl_file.name)
        self.assertEqual(stored.parent.as_posix(), "stl")
        self.assertRegex(stored.name, r"^[0-9a-f]{32}\.stl$")
        self.assertTrue((self.media_root / stored).is_file())

    def test_every_order_uses_the_same_custom_stamp_product(self):
        self.post_order()
        self.post_order()
        self.assertEqual(Product.objects.filter(name=CUSTOM_STAMP_PRODUCT_NAME).count(), 1)
        self.assertEqual(get_custom_stamp_product(), Order.objects.first().items.get().product)

    def test_invalid_fields_are_reported_by_the_names_the_page_uses(self):
        payload = self.payload()
        payload["order"].update(title="  ", quantity=0)
        payload["delivery"].update(
            firstName="", lastName=" ", email="nope", postalCode="12", houseNumber="12B", phone="abc"
        )

        response = self.post_order(payload)

        self.assertEqual(response.status_code, 400)
        errors = response.json()["errors"]
        self.assertEqual(set(errors["order"]), {"title", "quantity"})
        self.assertEqual(
            set(errors["delivery"]),
            {"firstName", "lastName", "email", "postalCode", "houseNumber", "phone"},
        )
        self.assertEqual(errors["delivery"]["postalCode"], "Use the format 1234 AB.")
        self.assertEqual(
            errors["delivery"]["houseNumber"], "Use digits only; put letters like A in the addition."
        )
        self.assertEqual((Order.objects.count(), Customer.objects.count()), (0, 0))

    def test_unknown_country_and_overlong_text_are_rejected(self):
        payload = self.payload()
        payload["delivery"].update(country="XX", city="x" * 101)
        payload["order"].update(title="t" * 81, notes="n" * 501)

        errors = self.post_order(payload).json()["errors"]

        self.assertEqual(set(errors["delivery"]), {"country", "city"})
        self.assertEqual(set(errors["order"]), {"title", "notes"})

    def test_a_file_that_does_not_match_the_stamp_settings_is_rejected(self):
        payload = self.payload()
        payload["measurements"] = {**payload["measurements"], "width": 80, "depth": 80}

        response = self.post_order(payload)

        self.assertEqual(response.status_code, 400)
        self.assertIn("does not match", response.json()["errors"]["general"])
        self.assertEqual(Order.objects.count(), 0)

    def test_measurements_are_required(self):
        for measurements in (None, "50x50", {"width": 50}):
            with self.subTest(measurements=measurements):
                response = self.post_order(self.payload(measurements=measurements))
                self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)

    def test_a_file_that_is_not_a_stl_is_rejected(self):
        response = self.post_order(stl=b"solid stamp\nendsolid stamp\n")
        self.assertEqual(response.status_code, 400)
        self.assertIn("binary STL", response.json()["errors"]["general"])
        self.assertEqual(Order.objects.count(), 0)

    def test_a_too_large_file_is_rejected(self):
        with mock.patch("orders.api.MAX_STL_BYTES", 1000):
            response = self.post_order()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)

    def test_a_broken_request_is_rejected(self):
        url = reverse(self.endpoint)
        upload = SimpleUploadedFile("stamp.stl", real_stamp()[0])
        cases = {
            "no file": {"payload": json.dumps(self.payload())},
            "no payload": {"stl": upload},
            "not json": {"payload": "{nope", "stl": upload},
            "not an object": {"payload": "[1, 2]", "stl": upload},
            "NaN in the json": {"payload": '{"order": NaN}', "stl": upload},
            "far too large": {"payload": " " * 1_000_001, "stl": upload},
        }
        for name, data in cases.items():
            with self.subTest(name):
                upload.seek(0)
                response = self.client.post(url, data)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)

    def test_only_post_is_allowed(self):
        self.assertEqual(self.client.get(reverse(self.endpoint)).status_code, 405)

    def test_the_csrf_check_is_enforced(self):
        response = self.post_order(client=Client(enforce_csrf_checks=True))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Order.objects.count(), 0)

    def test_the_csrf_token_from_the_page_is_accepted(self):
        client = Client(enforce_csrf_checks=True)
        page = client.get("/")
        token = re.search(r'name="csrf-token" content="([^"]+)"', page.content.decode()).group(1)
        response = client.post(
            reverse(self.endpoint),
            {
                "payload": json.dumps(self.payload()),
                "stl": SimpleUploadedFile("stamp.stl", real_stamp()[0]),
            },
            headers={"X-CSRFToken": token},
        )
        self.assertEqual(response.status_code, 201)


class PaymentFlowTests(OrderMixin, MediaTestCase):
    def test_the_pay_page_shows_what_is_to_be_paid(self):
        order, pay_url = self.place_order()
        response = self.client.get(pay_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Bakery logo")
        self.assertContains(response, f"€{money('24.95')}")
        self.assertContains(response, "Demo payment")

    def test_paying_accepts_the_order_sends_the_email_and_shows_the_order(self):
        order, pay_url = self.place_order()

        response = self.client.post(pay_url)

        self.assertRedirects(response, f"/order/{order.public_id}/", fetch_redirect_response=False)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.PROCESSING)
        self.assertTrue(order.is_paid)
        payment = order.payments.get()
        self.assertEqual((payment.provider, payment.amount), ("placeholder", Decimal("24.95")))
        self.assertIsNotNone(payment.paid_at)

        job = ProductionJob.objects.get()
        self.assertEqual((job.order_item, job.quantity), (order.items.get(), 2))

        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["jan@example.nl"])
        self.assertIn(f"#{order.pk}", message.subject)
        self.assertIn(f"http://testserver/order/{order.public_id}/", message.body)
        self.assertIn("Bakery logo", message.body)
        self.assertIn(f"EUR {money('24.95')}", message.body)

    def test_paying_twice_changes_nothing(self):
        order, pay_url = self.place_order()
        self.client.post(pay_url)

        again = self.client.post(pay_url)

        self.assertEqual(again.status_code, 302)
        self.assertEqual(order.payments.count(), 1)
        self.assertEqual(ProductionJob.objects.count(), 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_a_paid_order_sends_the_pay_page_on_to_the_order_page(self):
        order, pay_url = self.place_order()
        self.client.post(pay_url)
        self.assertRedirects(
            self.client.get(pay_url), f"/order/{order.public_id}/", fetch_redirect_response=False
        )

    def test_a_failing_email_does_not_undo_the_payment(self):
        order, pay_url = self.place_order()
        with mock.patch("django.core.mail.EmailMessage.send", side_effect=OSError("no smtp")):
            with self.assertLogs("orders.emails", level="ERROR"):
                response = self.client.post(pay_url)
        self.assertEqual(response.status_code, 302)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.PROCESSING)

    def test_an_unknown_order_cannot_be_paid(self):
        response = self.client.post("/order/6b0f7c1e-3c2c-4d3b-9a43-4a3b0c1d2e3f/pay/")
        self.assertEqual(response.status_code, 404)

    def test_the_pay_form_needs_the_csrf_token(self):
        order, pay_url = self.place_order()
        response = Client(enforce_csrf_checks=True).post(pay_url)
        self.assertEqual(response.status_code, 403)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.AWAITING_PAYMENT)


class CustomerOrderPageTests(OrderMixin, MediaTestCase):
    def test_shows_the_order_with_only_part_of_the_customers_details(self):
        order, _ = self.place_order()

        response = self.client.get(f"/order/{order.public_id}/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, f"Your order #{order.pk}")
        self.assertContains(response, "Bakery logo")
        self.assertContains(response, "Awaiting payment")
        self.assertContains(response, f"http://testserver/order/{order.public_id}/")
        self.assertContains(response, "Jan, Utrecht, Netherlands")
        self.assertContains(response, "j***@example.nl")
        for private in ("jan@example.nl", "Kerkstraat", "12B", "+31 6 12345678", "1234 AB", "de Vries"):
            self.assertNotContains(response, private)

    def test_an_unpaid_order_offers_payment_and_a_paid_one_does_not(self):
        order, pay_url = self.place_order()
        self.assertContains(self.client.get(f"/order/{order.public_id}/"), pay_url)

        self.client.post(pay_url)
        page = self.client.get(f"/order/{order.public_id}/")

        self.assertContains(page, "Payment received")
        self.assertNotContains(page, pay_url)

    def test_a_quantity_discount_is_shown_as_its_own_line(self):
        payload = self.payload()
        payload["order"]["quantity"] = 12
        order, pay_url = self.place_order(order=payload["order"])
        # 12 x 10.00 = 120.00 at full price, 10% off.
        for url in (pay_url, f"/order/{order.public_id}/"):
            with self.subTest(url):
                page = self.client.get(url)
                self.assertContains(page, "Quantity discount")
                self.assertContains(page, f"−€{money('12.00')}")

    def test_no_discount_line_when_there_is_no_discount(self):
        order, pay_url = self.place_order()
        self.assertNotContains(self.client.get(pay_url), "Quantity discount")

    def test_the_page_is_kept_out_of_caches_search_results_and_referrers(self):
        order, pay_url = self.place_order()
        for url in (f"/order/{order.public_id}/", pay_url):
            with self.subTest(url):
                response = self.client.get(url)
                self.assertIn("no-store", response["Cache-Control"])
                # Not "no-referrer": browsers then send "Origin: null" on the pay form, which CSRF rejects.
                self.assertEqual(response["Referrer-Policy"], "same-origin")
                self.assertContains(response, '<meta name="referrer" content="same-origin"')
                self.assertIn("noindex", response["X-Robots-Tag"])
                self.assertContains(response, 'name="robots" content="noindex, nofollow"')

    def test_only_the_random_link_works(self):
        order, _ = self.place_order()
        for url in (
            f"/order/{order.pk}/",
            f"/order/{order.pk}/pay/",
            "/order/6b0f7c1e-3c2c-4d3b-9a43-4a3b0c1d2e3f/",
        ):
            with self.subTest(url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_the_numeric_staff_page_is_not_open_to_customers(self):
        order, _ = self.place_order()
        response = self.client.get(f"/orders/{order.pk}/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response["Location"])

    def test_text_the_customer_typed_is_escaped(self):
        payload = self.payload()
        payload["order"]["title"] = "<script>alert(1)</script>"
        order, _ = self.place_order(order=payload["order"])
        page = self.client.get(f"/order/{order.public_id}/")
        self.assertNotContains(page, "<script>alert(1)</script>")
        self.assertContains(page, "&lt;script&gt;alert(1)&lt;/script&gt;")


class StaffOrderViewTests(OrderMixin, MediaTestCase):
    def setUp(self):
        super().setUp()
        self.order, self.pay_url = self.place_order()
        self.item = self.order.items.get()
        self.staff = get_user_model().objects.create_user("staff", password="pw", is_staff=True)

    def test_staff_can_download_the_customers_stamp_file(self):
        self.client.force_login(self.staff)
        response = self.client.get(reverse("orders:download_item_stl", args=[self.item.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), real_stamp()[0])
        self.assertIn("attachment", response["Content-Disposition"])

    def test_nobody_else_can(self):
        url = reverse("orders:download_item_stl", args=[self.item.pk])
        self.assertEqual(self.client.get(url).status_code, 302)
        customer = get_user_model().objects.create_user("customer", password="pw")
        self.client.force_login(customer)
        self.assertEqual(self.client.get(url).status_code, 302)

    def test_an_item_without_a_file_has_no_download(self):
        other = OrderItem.objects.create(
            order=self.order, product=self.item.product, quantity=1, unit_price=Decimal("1.00")
        )
        self.client.force_login(self.staff)
        response = self.client.get(reverse("orders:download_item_stl", args=[other.pk]))
        self.assertEqual(response.status_code, 404)

    def test_the_staff_pages_show_the_new_order(self):
        self.client.force_login(self.staff)
        detail = self.client.get(reverse("orders:order", args=[self.order.pk]))
        self.assertContains(detail, "Bakery logo")
        self.assertContains(detail, "Round logo for the bread.")
        self.assertContains(detail, reverse("orders:download_item_stl", args=[self.item.pk]))
        listing = self.client.get(reverse("orders:index"))
        self.assertContains(listing, "Awaiting payment")


class OrderOverviewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = get_user_model().objects.create_user("overview-staff", is_staff=True)
        customer = Customer.objects.create(
            first_name="Overview", last_name="Customer", email="overview@example.com"
        )
        cls.orders = {
            status: Order.objects.create(
                customer=customer,
                order_status=status,
                subtotal_price=Decimal("10.00"),
                shipping_costs=Decimal("5.00"),
                total_price=Decimal("15.00"),
            )
            for status in Order.OrderStatus
        }

    def setUp(self):
        self.client.force_login(self.staff)

    def test_default_open_includes_all_active_statuses_and_has_global_count(self):
        response = self.client.get(reverse("orders:index"))
        self.assertEqual(response.context["current_status"], "open")
        self.assertEqual(response.context["open_count"], 3)
        self.assertEqual(
            {order.order_status for order in response.context["orders"]},
            {Order.OrderStatus.AWAITING_PAYMENT, Order.OrderStatus.PROCESSING, Order.OrderStatus.READY},
        )
        self.assertContains(response, "Open (3)")
        self.assertContains(response, 'class="btn btn-sm btn-primary"', count=1)

    def test_each_filter_and_invalid_filter(self):
        expected = {
            "shipped": {Order.OrderStatus.SHIPPED},
            "completed": {Order.OrderStatus.COMPLETED},
            "cancelled": {Order.OrderStatus.CANCELLED},
            "all": set(Order.OrderStatus.values),
            "invalid": {Order.OrderStatus.AWAITING_PAYMENT, Order.OrderStatus.PROCESSING, Order.OrderStatus.READY},
        }
        for status, statuses in expected.items():
            with self.subTest(status=status):
                response = self.client.get(reverse("orders:index"), {"status": status})
                self.assertEqual(
                    {order.order_status for order in response.context["orders"]}, statuses
                )

    def test_shipped_count_stays_visible_outside_shipped_filter_and_search(self):
        for params in ({}, {"status": "shipped"}, {"status": "completed", "search": "missing"}):
            with self.subTest(params=params):
                response = self.client.get(reverse("orders:index"), params)
                self.assertEqual(response.context["shipped_count"], 1)
                self.assertContains(response, "Shipped (1)")
        self.orders[Order.OrderStatus.SHIPPED].delete()
        response = self.client.get(reverse("orders:index"))
        self.assertContains(response, "Shipped (0)")

    def test_search_combines_with_status_and_survives_filter_links(self):
        response = self.client.get(
            reverse("orders:index"), {"status": "completed", "search": "overview@example.com"}
        )
        self.assertEqual(list(response.context["orders"]), [self.orders[Order.OrderStatus.COMPLETED]])
        self.assertContains(response, 'name="status"\n        value="completed"')
        self.assertContains(response, '?status=all&amp;search=overview%40example.com')
        response = self.client.get(reverse("orders:index"), {"search": "missing"})
        self.assertEqual(response.context["orders"].count(), 0)
        self.assertEqual(response.context["open_count"], 3)

    def test_back_link_remembers_filter_and_search_after_detail_reload(self):
        self.client.get(reverse("orders:index"), {"status": "completed", "search": "Overview"})
        for _ in range(2):
            response = self.client.get(
                reverse("orders:order", args=[self.orders[Order.OrderStatus.COMPLETED].pk])
            )
            self.assertContains(response, '/orders/?status=completed&amp;search=Overview')

    def test_direct_detail_visit_returns_to_open(self):
        response = self.client.get(
            reverse("orders:order", args=[self.orders[Order.OrderStatus.PROCESSING].pk])
        )
        self.assertContains(response, '/orders/?status=open')
