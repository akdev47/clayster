from django.test import TestCase

from .pricing import estimate_price
# Create your tests here.
class PricingTest(TestCase):
    def test_price_estimate(self):
        self.assertEqual(
            1741, 
            estimate_price(
                {"faceShape": "square", "faceSize": 40, "handle": "knob"},
                info=None,
                quantity=1, 
                country="NL"
                )["total_cents"]
            )

    def test_round_stamp_no_handle(self):
        self.assertEqual(
            1620, 
            estimate_price(
                {"faceShape": "round", "faceSize": 40, "handle": "none"},
                info=None,
                quantity=1,
                country="BE",
                )["total_cents"]
            )

    def test_quantity_discount_free_shipping(self):
        self.assertEqual(
            10836,
            estimate_price(
                {"faceShape": "square", "faceSize": 30, "handle": "knob"},
                info=None,
                quantity=10,
                country="DE",
                )["total_cents"]
        )

    # expected to use other_zone pricing
    def test_unknown_country(self):
        self.assertEqual(
            2243,
            estimate_price(
                {"faceShape": "square", "faceSize": 40, "handle": "none"},
                info={"width": 52.5, "depth": 31},
                quantity=1,
                country="US",
                )["total_cents"]
        )

    def test_rounds_half_like_javascript(self):
        self.assertEqual(
            897,
            estimate_price(
                {"faceShape": "square", "faceSize": 40, "handle": "none"},
                info={"width": 50, "depth": 15.5},
                quantity=1,
                country="NL"
            )["unit_cents"]
        )

    def test_invalid_qunatity_is_none(self):
        self.assertIsNone(
            estimate_price(
                {"faceShape": "square", "faceSize": 40, "handle": "none"}, 
                info=None,
                quantity=0,
                country="NL"
            )["total_cents"]
        )