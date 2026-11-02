import json
import re

from django.contrib.auth import get_user_model
from django.template.loader import render_to_string
from django.test import TestCase, override_settings, tag


@tag("normal")
class IndexViewTests(TestCase):
    # Test category: normal. Serves the stamp editor page.
    def test_page_serves_the_tool_at_the_site_root(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "/static/stamp_generator/js/main.js")
        self.assertContains(response, "/static/stamp_generator/css/style.css")

    def test_page_has_no_remote_javascript(self):
        response = self.client.get("/")

        for src in re.findall(r'<script[^>]*\ssrc="([^"]+)"', response.content.decode()):
            self.assertTrue(src.startswith("/static/"), src)

    def test_import_map_points_at_vendored_static_files(self):
        response = self.client.get("/")

        match = re.search(
            r'<script type="importmap">(.*?)</script>',
            response.content.decode(),
            re.DOTALL,
        )
        self.assertIsNotNone(match)
        imports = json.loads(match.group(1))["imports"]
        self.assertEqual(imports["three"], "/static/vendor/three/build/three.module.js")
        self.assertEqual(imports["three/addons/"], "/static/vendor/three/examples/jsm/")
        self.assertEqual(
            imports["manifold-3d/manifold.wasm"],
            "/static/vendor/manifold-3d/manifold.wasm",
        )
        for name, url in imports.items():
            self.assertEqual(name.endswith("/"), url.endswith("/"), name)

    def test_page_gives_the_order_page_its_config_and_csrf_token(self):
        response = self.client.get("/")

        match = re.search(
            r'<script id="clayster-config" type="application/json">(.*?)</script>',
            response.content.decode(),
            re.DOTALL,
        )
        self.assertIsNotNone(match)
        config = json.loads(match.group(1))
        self.assertEqual(config["orderEndpoint"], "/api/orders/")
        self.assertEqual(config["pricing"]["currency"], "EUR")
        self.assertRegex(response.content.decode(), r'<meta name="csrf-token" content="[^"]+"')


@tag("normal")
class StlExportAccessTests(TestCase):
    # Test category: normal. The development STL export button is hidden from customers.
    """The "Export STL" button is for development and staff, not for customers."""

    def can_export(self):
        response = self.client.get("/")
        match = re.search(
            r'<script id="clayster-config" type="application/json">(.*?)</script>',
            response.content.decode(),
            re.DOTALL,
        )
        return json.loads(match.group(1))["canExportStl"]

    @override_settings(DEBUG=True)
    def test_anyone_may_export_while_developing(self):
        self.assertIs(self.can_export(), True)

    @override_settings(DEBUG=False)
    def test_customers_cannot_export_in_production(self):
        self.assertIs(self.can_export(), False)

        customer = get_user_model().objects.create_user("customer", password="pw")
        self.client.force_login(customer)
        self.assertIs(self.can_export(), False)

    @override_settings(DEBUG=False)
    def test_staff_may_still_export_in_production(self):
        staff = get_user_model().objects.create_user("shop-staff", password="pw", is_staff=True)
        self.client.force_login(staff)
        self.assertIs(self.can_export(), True)


@tag("normal")
class ErrorPageTests(TestCase):
    # Test category: normal. The 404 and 500 pages a customer sees, in Dutch.
    """A customer who follows a wrong link or meets an error reads Dutch."""

    @override_settings(DEBUG=False)
    def test_a_page_that_does_not_exist_is_explained_in_dutch(self):
        response = self.client.get("/order/00000000-0000-0000-0000-000000000000/")

        self.assertEqual(response.status_code, 404)
        self.assertContains(response, "Pagina niet gevonden", status_code=404)
        self.assertContains(response, "Naar de stempeleditor", status_code=404)

    def test_the_server_error_page_is_dutch_and_stands_alone(self):
        page = render_to_string("500.html")

        self.assertIn("Er ging iets mis", page)
        self.assertIn('lang="nl"', page)
        self.assertNotIn("{%", page)
