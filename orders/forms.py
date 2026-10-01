from django import forms

from customers.models import Customer

class CheckoutForm(forms.ModelForm):
    class Meta:
        model = Customer
        fields = ["email", "first_name", "last_name", "phone"]

    def __init__(self, *args, **kwargs):
        super.__init__(*args, **kwargs)
        self.fields["phone"].required = True