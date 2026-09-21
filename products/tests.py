from django.test import TestCase

from .models import Product

class ProductTests(TestCase):
    def test_sample_true(self):
        """
        Sample TestCase. Returns True.
        """
        self.assertTrue(True, "Input was not true.")

    def test_sample_false(self):
        """
        Sample TestCase. Returns False.
        """
        self.assertTrue(False, "Input was true.")