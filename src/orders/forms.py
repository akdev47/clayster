import re

from django import forms

from .pricing import COUNTRIES, MAX_QUANTITY

# The field names are the ones the stamp generator's order page uses, so the
# errors returned by the API can be shown next to the right input as they are.

POSTAL_CODE_PATTERNS = {
    "NL": (r"^\d{4}\s?[A-Za-z]{2}$", "Use the format 1234 AB."),
    "BE": (r"^\d{4}$", "Use a 4-digit postal code."),
    "DE": (r"^\d{5}$", "Use a 5-digit postal code."),
    "FR": (r"^\d{5}$", "Use a 5-digit postal code."),
}

QUANTITY_ERROR = f"Quantity must be a whole number from 1 to {MAX_QUANTITY}."


class OrderDetailsForm(forms.Form):
    title = forms.CharField(
        max_length=80,
        error_messages={"required": "Give this order item a name."},
    )
    description = forms.CharField(max_length=500, required=False)
    quantity = forms.IntegerField(
        min_value=1,
        max_value=MAX_QUANTITY,
        error_messages={
            "required": QUANTITY_ERROR,
            "invalid": QUANTITY_ERROR,
            "min_value": QUANTITY_ERROR,
            "max_value": QUANTITY_ERROR,
        },
    )
    notes = forms.CharField(max_length=500, required=False)


class DeliveryForm(forms.Form):
    firstName = forms.CharField(
        max_length=50,
        error_messages={"required": "Enter the first name."},
    )
    lastName = forms.CharField(
        max_length=100,
        error_messages={"required": "Enter the last name."},
    )
    email = forms.EmailField(
        max_length=254,
        error_messages={
            "required": "Enter a valid email address.",
            "invalid": "Enter a valid email address.",
        },
    )
    phone = forms.CharField(max_length=20, required=False)
    street = forms.CharField(max_length=100, error_messages={"required": "Enter the street."})
    # The number is an integer in the database; letters go in the addition.
    houseNumber = forms.CharField(
        max_length=5,
        error_messages={"required": "Enter the house number."},
    )
    houseNumberAddition = forms.CharField(max_length=20, required=False)
    postalCode = forms.CharField(
        max_length=10,
        error_messages={"required": "Enter the postal code."},
    )
    city = forms.CharField(max_length=100, error_messages={"required": "Enter the city."})
    country = forms.ChoiceField(
        choices=list(COUNTRIES.items()),
        error_messages={
            "required": "Choose a country.",
            "invalid_choice": "Choose a country.",
        },
    )

    def clean_phone(self):
        phone = self.cleaned_data["phone"]
        if phone and not re.fullmatch(r"[+()\d\s-]{6,20}", phone):
            raise forms.ValidationError("Use digits, spaces, + ( ) or - only.")
        return phone

    def clean_houseNumber(self):
        number = self.cleaned_data["houseNumber"]
        if not re.fullmatch(r"[1-9]\d{0,4}", number):
            raise forms.ValidationError("Use digits only; put letters like A in the addition.")
        return number

    def clean(self):
        cleaned = super().clean()
        pattern = POSTAL_CODE_PATTERNS.get(cleaned.get("country"))
        postal = cleaned.get("postalCode")
        if pattern and postal and not re.fullmatch(pattern[0], postal):
            self.add_error("postalCode", pattern[1])
        return cleaned

    # --- how the fields map onto the models ---------------------------------

    def customer_fields(self):
        return {
            "first_name": self.cleaned_data["firstName"],
            "last_name": self.cleaned_data["lastName"],
            "email": self.cleaned_data["email"],
            "phone": self.cleaned_data["phone"],
        }

    def address_fields(self):
        return {
            "street_name": self.cleaned_data["street"],
            "house_number": int(self.cleaned_data["houseNumber"]),
            "house_number_addition": self.cleaned_data["houseNumberAddition"],
            "postal_code": self.cleaned_data["postalCode"].upper(),
            "city": self.cleaned_data["city"],
            "country": COUNTRIES[self.cleaned_data["country"]],
        }
