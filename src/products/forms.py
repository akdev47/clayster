from django import forms
from django.core.exceptions import ValidationError

from .models import Product


class ProductForm(forms.ModelForm):
    class Meta:
        model = Product

        fields = [
            "name",
            "short_description",
            "long_description",
            "price",
            "product_type",
            "category",
            "on_website",
            "file",
        ]

        widgets = {
            "name": forms.TextInput(attrs={
                "class": "form-control",
            }),
            "short_description": forms.TextInput(attrs={
                "class": "form-control",
            }),
            "long_description": forms.Textarea(attrs={
                "class": "form-control",
                "rows": 4,
            }),
            "price": forms.NumberInput(attrs={
                "class": "form-control",
                "step": "0.01",
                "min": "0",
            }),
            "product_type": forms.Select(attrs={
                "class": "form-select",
            }),
            "category": forms.Select(attrs={
                "class": "form-select",
            }),
            "on_website": forms.CheckboxInput(attrs={
                "class": "form-check-input",
            }),
            "file": forms.ClearableFileInput(attrs={
                "class": "form-control",
                "accept": ".stl",
            }),
        }

    def clean_file(self):
        file = self.cleaned_data.get("file")

        if file and not file.name.lower().endswith(".stl"):
            raise ValidationError("Please upload an STL file.")

        return file