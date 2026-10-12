from django import forms

from .models import ProductionJob


class ProductionJobForm(forms.ModelForm):
    class Meta:
        model = ProductionJob
        fields = [
            "product",
            "quantity",
        ]

        widgets = {
            "product": forms.Select(
                attrs={"class": "form-select"}
            ),
            "quantity": forms.NumberInput(
                attrs={
                    "class": "form-control",
                    "min": 1,
                }
            ),
        }