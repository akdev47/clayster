from django.test import TestCase

from .models import Product

class ProductTests(TestCase):
    def setUp(self):
        """
        First object
        """
        Product.objects.create(
            name = "Test product unit test",
            description = "A product that is created in the unit test test_create_product() at /products/test.py.",
            price = 40.0,
            product_type = Product.ProductType.STANDARD,
        )
        

    def test_get_object(self):
        """
        Tests getting an object by primary key from the database.
        """
        test_product = Product.objects.get(pk=1)
        self.assertEqual(test_product.name, "Test product unit test")

    