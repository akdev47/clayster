from decimal import Decimal

from django.test import TestCase

from .models import Product
from .utils import create_dummy_product

class ProductTests(TestCase):
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

class ProductCreate(TestCase):
    # create product with expected fields
    def test_prouct_creation(self):
        product = create_dummy_product()

        self.assertEqual(product.name, "Stamp_Dummy")
        self.assertEqual(product.price, Decimal("10.00"))
        self.assertEqual(product.product_type, Product.ProductType.STANDARD)
        self.assertEqual(Product.objects.count(), 1)

    # call dummy product creation twice to return same output
    def test_calling_twice(self):
        frst = create_dummy_product()
        snd = create_dummy_product()

        self.assertEqual(frst.pk, snd.pk)
        self.assertEqual(Product.objects.count(), 1)