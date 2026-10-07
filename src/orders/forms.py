from django import forms

from customers.models import Customer
from .models import OrderAddress

class CheckoutForm(forms.ModelForm):
    class Meta:
        model = Customer
        fields = ["email", "first_name", "last_name", "phone"]


class OrderAddressForm(forms.ModelForm):
    class Meta:
        model = OrderAddress
        fields = [
            "street_name", 
            "house_number", 
            "house_number_addition",
            "postal_code",
            "city",
            "country",
            ]

class CustomerForm(forms.ModelForm):
    class Meta:
        model = Customer
        fields = ["email", "first_name", "last_name", "phone"]
