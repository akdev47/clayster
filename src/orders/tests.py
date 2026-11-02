import json
import re
import struct
import tempfile
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase, TestCase, override_settings, tag
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


@tag("critical")
class PricingTests(SimpleTestCase):
    # Test category: critical. Calculates what the customer pays.
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
        # Kept from the original pricing tests. The handle used to cost 3.00
        # extra, so the two cases that had one are now 3.00 per stamp cheaper.
        small = {"faceShape": "square", "faceSize": 40, "handle": "small"}
        plain = {"faceShape": "square", "faceSize": 40, "handle": "none"}
        cases = [
            ("square with a handle, no measurements", small, None, 1, "NL", "total_cents", 1441),
            ("round without handle, Belgium", {**plain, "faceShape": "round"}, None, 1, "BE", "total_cents", 1620),
            ("discount and free shipping", {**small, "faceSize": 30}, None, 10, "DE", "total_cents", 8136),
            ("unknown country uses the other zone", plain, {"width": 52.5, "depth": 31}, 1, "US", "total_cents", 2243),
            ("rounds half up like JavaScript", plain, {"width": 50, "depth": 15.5}, 1, "NL", "unit_cents", 897),
        ]
        for name, stamp, info, quantity, country, key, expected in cases:
            with self.subTest(name):
                self.assertEqual(estimate_price(stamp, info, quantity, country)[key], expected)

    def test_the_handle_is_free(self):
        info = {"width": 40, "depth": 40}
        for shape in ("round", "square"):
            prices = {
                handle: estimate_price(
                    {"faceShape": shape, "faceSize": 40, "handle": handle}, info, 3, "NL"
                )
                for handle in ("small", "none")
            }
            with self.subTest(shape=shape):
                self.assertEqual(prices["small"], prices["none"])

    def test_the_page_price_list_has_no_handle_price(self):
        self.assertNotIn("handle_cents", pricing.PRICING)
        self.assertNotIn("handleCents", pricing.pricing_for_page())

    def test_countries_and_shipping_zones_agree(self):
        zones = set(pricing.PRICING["shipping"]["by_country_cents"])
        self.assertEqual(set(pricing.COUNTRIES), zones)

    def test_the_largest_stamp_is_200_by_200_mm(self):
        stamp = {"faceShape": "square", "faceSize": 50, "handle": "small"}
        self.assertEqual(
            (pricing.MAX_STAMP_WIDTH_MM, pricing.MAX_STAMP_LENGTH_MM), (200, 200)
        )
        # Exactly the maximum fits, and so does a hair over it (compared to 0.01 mm).
        for info in ({"width": 200, "depth": 200}, {"width": 200.004, "depth": 199.996}):
            with self.subTest(info=info):
                estimate_price(stamp, info, 1, "NL")
        # Width and length are limited separately; the message names the maximum.
        for info in ({"width": 200.02, "depth": 100}, {"width": 100, "depth": 200.02},
                     {"width": 250, "depth": 250}):
            with self.subTest(info=info), self.assertRaisesMessage(
                PricingError, "hoogstens 200 × 200 mm"
            ):
                estimate_price(stamp, info, 1, "NL")
        # Without measurements the face size setting stands in for both.
        with self.assertRaisesMessage(PricingError, "hoogstens 200 × 200 mm"):
            estimate_price({**stamp, "faceSize": 201}, None, 1, "NL")

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


@tag("critical")
class StlTests(SimpleTestCase):
    # Test category: critical. Checks uploaded files before they are stored.
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


@tag("critical")
class CreateOrderTests(OrderMixin, MediaTestCase):
    # Test category: critical. Stores customer input and orders from the website.
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
        self.assertEqual(order.address.country, "Nederland")

        item = order.items.get()
        self.assertEqual(item.display_name, "Bakery logo")
        self.assertEqual(item.description, "Round logo for the bread.")
        self.assertEqual((item.quantity, item.unit_price), (2, Decimal("10.00")))
        self.assertEqual(item.product.product_type, Product.ProductType.CUSTOM_STAMP)
        self.assertEqual(item.design["measurements"]["width"], 50)
        self.assertEqual(item.design["stl"]["triangles"], 288)
        with item.stl_file.open("rb") as stl:
            self.assertEqual(stl.read(), real_stamp()[0])

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
        self.assertEqual(errors["delivery"]["postalCode"], "Gebruik het formaat 1234 AB.")
        self.assertEqual(
            errors["delivery"]["houseNumber"], "Gebruik alleen cijfers; zet letters zoals A bij de toevoeging."
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
        self.assertIn("komt niet overeen", response.json()["errors"]["general"])
        self.assertEqual(Order.objects.count(), 0)

    def test_a_stamp_larger_than_200_by_200_mm_is_refused(self):
        for measurements in ({"width": 201, "depth": 50, "height": 6},
                             {"width": 50, "depth": 201, "height": 6}):
            with self.subTest(measurements=measurements):
                payload = self.payload()
                payload["measurements"] = {**payload["measurements"], **measurements}

                response = self.post_order(payload)

                self.assertEqual(response.status_code, 400)
                self.assertIn("hoogstens 200 × 200 mm", response.json()["errors"]["general"])
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
        self.assertIn("binaire STL", response.json()["errors"]["general"])
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


@tag("critical")
class PaymentFlowTests(OrderMixin, MediaTestCase):
    # Test category: critical. Payments and handing paid orders to production.
    def test_the_pay_page_shows_what_is_to_be_paid(self):
        order, pay_url = self.place_order()
        response = self.client.get(pay_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Bakery logo")
        self.assertContains(response, f"€&nbsp;{money('24.95')}")
        self.assertContains(response, "Demobetaling")

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
        self.assertIn(f"€ {money('24.95')}", message.body)

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


@tag("critical")
class CustomerOrderPageTests(OrderMixin, MediaTestCase):
    # Test category: critical. Customer pages reachable by a secret link.
    def test_shows_the_order_with_only_part_of_the_customers_details(self):
        order, _ = self.place_order()

        response = self.client.get(f"/order/{order.public_id}/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, f"Je bestelling #{order.pk}")
        self.assertContains(response, "Bakery logo")
        self.assertContains(response, "Wacht op betaling")
        self.assertContains(response, f"http://testserver/order/{order.public_id}/")
        self.assertContains(response, "Jan, Utrecht, Nederland")
        self.assertContains(response, "j***@example.nl")
        for private in ("jan@example.nl", "Kerkstraat", "12B", "+31 6 12345678", "1234 AB", "de Vries"):
            self.assertNotContains(response, private)

    def test_an_unpaid_order_offers_payment_and_a_paid_one_does_not(self):
        order, pay_url = self.place_order()
        self.assertContains(self.client.get(f"/order/{order.public_id}/"), pay_url)

        self.client.post(pay_url)
        page = self.client.get(f"/order/{order.public_id}/")

        self.assertContains(page, "Betaling ontvangen")
        self.assertNotContains(page, pay_url)

    def test_a_quantity_discount_is_shown_as_its_own_line(self):
        payload = self.payload()
        payload["order"]["quantity"] = 12
        order, pay_url = self.place_order(order=payload["order"])
        # 12 x 10.00 = 120.00 at full price, 10% off.
        for url in (pay_url, f"/order/{order.public_id}/"):
            with self.subTest(url):
                page = self.client.get(url)
                self.assertContains(page, "Staffelkorting")
                self.assertContains(page, f"−€&nbsp;{money('12.00')}")

    def test_no_discount_line_when_there_is_no_discount(self):
        order, pay_url = self.place_order()
        self.assertNotContains(self.client.get(pay_url), "Staffelkorting")

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


@tag("critical")
class StaffOrderViewTests(OrderMixin, MediaTestCase):
    # Test category: critical. Staff actions that change order status and stock.
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


Status = Order.OrderStatus
JobStatus = ProductionJob.ProductionStatus


class StaffOrderMixin:
    """A logged-in staff member and helpers to build orders without the website."""

    def setUp(self):
        super().setUp()
        self.staff = get_user_model().objects.create_user("staff", is_staff=True)
        self.client.force_login(self.staff)
        self.customer = Customer.objects.create(first_name="Anna", last_name="Jansen", email="anna@example.nl")
        self.mug = Product.objects.create(name="Mug stamp", price=Decimal("5.00"), stock=10)
        self.custom = get_custom_stamp_product()

    def make_order(self, status=Status.PROCESSING, customer=None):
        return Order.objects.create(
            customer=customer or self.customer,
            order_status=status,
            subtotal_price=Decimal("10.00"),
            shipping_costs=Decimal("5.00"),
            total_price=Decimal("15.00"),
        )

    def add_item(self, order, product=None, quantity=2, is_ready=False):
        product = product or self.mug
        return OrderItem.objects.create(
            order=order,
            product=product,
            name=product.name,
            quantity=quantity,
            unit_price=product.price,
            is_ready=is_ready,
        )

    def post(self, name, pk, data=None):
        return self.client.post(reverse(f"orders:{name}", args=[pk]), data or {})

    def assert_back_on_order(self, response, order):
        self.assertRedirects(response, reverse("orders:order", args=[order.pk]))

    def stock(self):
        self.mug.refresh_from_db()
        return self.mug.stock


@tag("critical")
class StaffOrderPermissionTests(StaffOrderMixin, TestCase):
    # Test category: critical. Only staff may see or change orders.

    def test_visitors_and_customers_are_sent_to_login(self):
        order = self.make_order()
        item = self.add_item(order)
        requests = [
            ("get", reverse("orders:index"), {}),
            ("get", reverse("orders:order", args=[order.pk]), {}),
            ("post", reverse("orders:change_status", args=[order.pk]), {"status": Status.SHIPPED}),
            ("post", reverse("orders:mark_item_ready", args=[item.pk]), {}),
            ("post", reverse("orders:undo_item_ready", args=[item.pk]), {}),
            ("post", reverse("orders:add_to_production", args=[item.pk]), {}),
        ]
        customer = get_user_model().objects.create_user("customer")

        for login in [None, customer]:
            self.client.logout()
            if login:
                self.client.force_login(login)
            for method, url, data in requests:
                with self.subTest(user=login, url=url):
                    response = getattr(self.client, method)(url, data)
                    self.assertEqual(response.status_code, 302)
                    self.assertTrue(response.url.startswith(reverse("admin:login")), response.url)

        order.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(order.order_status, Status.PROCESSING)
        self.assertFalse(item.is_ready)
        self.assertFalse(ProductionJob.objects.exists())
        self.assertEqual(self.stock(), 10)


@tag("critical")
class StaffOrderListTests(StaffOrderMixin, TestCase):
    # Test category: critical. Staff find orders by status, customer or order number.

    def setUp(self):
        super().setUp()
        other = Customer.objects.create(first_name="Piet", last_name="Bakker", email="piet@bakker.nl")
        self.processing = self.make_order()
        self.shipped = self.make_order(status=Status.SHIPPED, customer=other)
        self.add_item(self.processing, quantity=3)
        # Created in the same instant otherwise; make the shipped order the newer one.
        Order.objects.filter(pk=self.processing.pk).update(
            created_at=self.shipped.created_at - timedelta(seconds=1)
        )

    def listed(self, **params):
        # The list shows only open orders unless a status filter is given.
        params.setdefault("status", "all")
        response = self.client.get(reverse("orders:index"), params)
        self.assertEqual(response.status_code, 200)
        return list(response.context["orders"])

    def test_lists_every_order_newest_first(self):
        self.assertEqual(self.listed(), [self.shipped, self.processing])

    def test_counts_items_and_orders_per_status(self):
        response = self.client.get(reverse("orders:index"), {"status": "all"})
        orders = {order.pk: order for order in response.context["orders"]}

        self.assertEqual(orders[self.processing.pk].item_count, 3)
        self.assertEqual(orders[self.shipped.pk].item_count, 0)
        self.assertEqual(response.context["processing_count"], 1)
        self.assertEqual(response.context["ready_count"], 0)
        self.assertEqual(response.context["today_count"], 2)

    def test_filters_by_status(self):
        self.assertEqual(self.listed(status="shipped"), [self.shipped])
        self.assertEqual(self.listed(status="open"), [self.processing])

    def test_searches_by_name_and_email(self):
        self.assertEqual(self.listed(search="bakker"), [self.shipped])
        self.assertEqual(self.listed(search="ANNA@example"), [self.processing])

    def test_searches_by_order_number(self):
        self.assertEqual(self.listed(search=str(self.processing.pk)), [self.processing])

    def test_order_page_shows_the_order(self):
        response = self.client.get(reverse("orders:order", args=[self.processing.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["order"], self.processing)
        self.assertContains(response, "Anna")

    def test_unknown_order_is_not_found(self):
        response = self.client.get(reverse("orders:order", args=[9999]))

        self.assertEqual(response.status_code, 404)


@tag("critical")
class ChangeStatusTests(StaffOrderMixin, TestCase):
    # Test category: critical. Order status changes, including cancelling, which returns stock.

    def test_changes_the_status(self):
        order = self.make_order()

        response = self.post("change_status", order.pk, {"status": Status.SHIPPED})

        self.assert_back_on_order(response, order)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Status.SHIPPED)

    def test_unknown_status_is_refused(self):
        order = self.make_order()

        self.post("change_status", order.pk, {"status": "XX"})

        order.refresh_from_db()
        self.assertEqual(order.order_status, Status.PROCESSING)

    def test_same_status_changes_nothing(self):
        order = self.make_order(status=Status.READY)

        response = self.post("change_status", order.pk, {"status": Status.READY})

        self.assert_back_on_order(response, order)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Status.READY)

    def test_shipped_and_completed_orders_cannot_be_cancelled(self):
        for status in [Status.SHIPPED, Status.COMPLETED]:
            order = self.make_order(status=status)
            with self.subTest(status=status):
                self.post("change_status", order.pk, {"status": Status.CANCELLED})
                order.refresh_from_db()
                self.assertEqual(order.order_status, status)

    def test_cancelling_cancels_waiting_production_jobs(self):
        order = self.make_order()
        item = self.add_item(order, product=self.custom)
        waiting = ProductionJob.objects.create(product=self.custom, order_item=item, quantity=2)
        printing = ProductionJob.objects.create(
            product=self.custom, order_item=item, quantity=1, status=JobStatus.PRINTING
        )

        self.post("change_status", order.pk, {"status": Status.CANCELLED})

        order.refresh_from_db()
        waiting.refresh_from_db()
        printing.refresh_from_db()
        self.assertEqual(order.order_status, Status.CANCELLED)
        self.assertEqual(waiting.status, JobStatus.CANCELLED)
        self.assertEqual(printing.status, JobStatus.PRINTING)

    def test_cancelling_returns_the_stock_of_ready_items(self):
        # Marking the item ready took 2 from stock; cancelling must give them back.
        order = self.make_order()
        item = self.add_item(order, quantity=2)
        self.post("mark_item_ready", item.pk)
        self.assertEqual(self.stock(), 8)

        self.post("change_status", order.pk, {"status": Status.CANCELLED})

        item.refresh_from_db()
        self.assertEqual(self.stock(), 10)
        self.assertFalse(item.is_ready)

    def test_only_accepts_post(self):
        order = self.make_order()

        response = self.client.get(reverse("orders:change_status", args=[order.pk]))

        self.assertEqual(response.status_code, 405)


@tag("critical")
class ItemReadyTests(StaffOrderMixin, TestCase):
    # Test category: critical. Marking items ready reserves stock; undoing returns it.

    def test_ready_standard_item_takes_stock(self):
        order = self.make_order()
        item = self.add_item(order, quantity=3)

        response = self.post("mark_item_ready", item.pk)

        self.assert_back_on_order(response, order)
        item.refresh_from_db()
        self.assertTrue(item.is_ready)
        self.assertEqual(self.stock(), 7)

    def test_not_enough_stock_is_refused(self):
        order = self.make_order()
        item = self.add_item(order, quantity=11)

        self.post("mark_item_ready", item.pk)

        item.refresh_from_db()
        self.assertFalse(item.is_ready)
        self.assertEqual(self.stock(), 10)

    def test_custom_stamp_takes_no_stock(self):
        order = self.make_order()
        item = self.add_item(order, product=self.custom, quantity=5)

        self.post("mark_item_ready", item.pk)

        item.refresh_from_db()
        self.assertTrue(item.is_ready)
        self.assertEqual(self.stock(), 10)

    def test_order_is_ready_when_all_items_are(self):
        order = self.make_order()
        first = self.add_item(order, quantity=1)
        second = self.add_item(order, product=self.custom)

        self.post("mark_item_ready", first.pk)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Status.PROCESSING)

        self.post("mark_item_ready", second.pk)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Status.READY)

    def test_marking_twice_takes_stock_once(self):
        order = self.make_order()
        item = self.add_item(order, quantity=3)

        self.post("mark_item_ready", item.pk)
        self.post("mark_item_ready", item.pk)

        self.assertEqual(self.stock(), 7)

    def test_finished_orders_cannot_change(self):
        for status in [Status.SHIPPED, Status.COMPLETED, Status.CANCELLED]:
            order = self.make_order(status=status)
            item = self.add_item(order)
            ready_item = self.add_item(order, is_ready=True)
            with self.subTest(status=status):
                self.post("mark_item_ready", item.pk)
                self.post("undo_item_ready", ready_item.pk)
                item.refresh_from_db()
                ready_item.refresh_from_db()
                self.assertFalse(item.is_ready)
                self.assertTrue(ready_item.is_ready)
                self.assertEqual(self.stock(), 10)

    def test_undo_returns_the_stock(self):
        order = self.make_order()
        item = self.add_item(order, quantity=3)
        self.post("mark_item_ready", item.pk)

        response = self.post("undo_item_ready", item.pk)

        self.assert_back_on_order(response, order)
        item.refresh_from_db()
        self.assertFalse(item.is_ready)
        self.assertEqual(self.stock(), 10)

    def test_undo_puts_a_ready_order_back_in_processing(self):
        order = self.make_order()
        item = self.add_item(order, product=self.custom)
        self.post("mark_item_ready", item.pk)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Status.READY)

        self.post("undo_item_ready", item.pk)

        order.refresh_from_db()
        self.assertEqual(order.order_status, Status.PROCESSING)

    def test_undo_on_an_item_that_is_not_ready_changes_nothing(self):
        order = self.make_order()
        item = self.add_item(order)

        self.post("undo_item_ready", item.pk)

        item.refresh_from_db()
        self.assertFalse(item.is_ready)
        self.assertEqual(self.stock(), 10)

    def test_unknown_item_is_not_found(self):
        for name in ["mark_item_ready", "undo_item_ready", "add_to_production"]:
            with self.subTest(view=name):
                self.assertEqual(self.post(name, 9999).status_code, 404)


@tag("critical")
class AddItemToProductionTests(StaffOrderMixin, TestCase):
    # Test category: critical. Sending an order item to production, never twice.

    def test_creates_a_job_for_the_item(self):
        order = self.make_order()
        item = self.add_item(order, product=self.custom, quantity=4)

        response = self.post("add_to_production", item.pk)

        self.assert_back_on_order(response, order)
        job = ProductionJob.objects.get()
        self.assertEqual(job.order_item, item)
        self.assertEqual(job.product, self.custom)
        self.assertEqual(job.quantity, 4)

    def test_an_item_is_added_only_once(self):
        item = self.add_item(self.make_order(), product=self.custom)

        self.post("add_to_production", item.pk)
        self.post("add_to_production", item.pk)

        self.assertEqual(ProductionJob.objects.count(), 1)

    def test_a_cancelled_job_can_be_replaced(self):
        item = self.add_item(self.make_order(), product=self.custom)
        ProductionJob.objects.create(
            product=self.custom, order_item=item, quantity=2, status=JobStatus.CANCELLED
        )

        self.post("add_to_production", item.pk)

        self.assertEqual(ProductionJob.objects.filter(status=JobStatus.WAITING).count(), 1)


@tag("not-critical")
class TestOrderButtonTests(StaffOrderMixin, TestCase):
    # Test category: not-critical. Debug buttons that create test orders, only with DEBUG on.

    def test_hidden_when_debug_is_off(self):
        for name in ["test_custom_order", "test_standard_order"]:
            with self.subTest(view=name):
                response = self.client.post(reverse(f"orders:{name}"), {"product_id": self.mug.pk})
                self.assertEqual(response.status_code, 404)
        self.assertFalse(Order.objects.exists())

    @override_settings(DEBUG=True)
    def test_custom_test_order_goes_to_production(self):
        response = self.client.post(reverse("orders:test_custom_order"))

        order = Order.objects.get()
        self.assertRedirects(response, reverse("orders:order", args=[order.pk]))
        self.assertEqual(order.total_price, Decimal("24.95"))
        self.assertEqual(ProductionJob.objects.get().order_item, order.items.get())

    @override_settings(DEBUG=True)
    def test_standard_test_order_uses_the_chosen_product(self):
        response = self.client.post(reverse("orders:test_standard_order"), {"product_id": self.mug.pk})

        order = Order.objects.get()
        self.assertRedirects(response, reverse("orders:order", args=[order.pk]))
        self.assertEqual(order.items.get().product, self.mug)
        self.assertFalse(ProductionJob.objects.exists())

    @override_settings(DEBUG=True)
    def test_standard_test_order_refuses_a_custom_product(self):
        response = self.client.post(reverse("orders:test_standard_order"), {"product_id": self.custom.pk})

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Order.objects.exists())


@tag("critical")
class OrderOverviewTests(TestCase):
    # Test category: critical. Staff order list filters, counts and search.
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
