from django.db import models

class Customer(models.Model):
    email = models.CharField(max_length=254)
    first_name = models.CharField(max_length=50)
    last_name = models.CharField(max_length=100)
    phone = models.CharField(max_length=20)

    def __str__(self):
            return self.first_name, self.last_name

