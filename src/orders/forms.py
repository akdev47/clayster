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
            "required": f"Quantity must be a whole number from 1 to {MAX_QUANTITY}.",
            "invalid": f"Quantity must be a whole number from 1 to {MAX_QUANTITY}.",
            "min_value": f"Quantity must be a whole number from 1 to {MAX_QUANTITY}.",
            "max_value": f"Quantity must be a whole number from 1 to {MAX_QUANTITY}.",
        },
    )
    notes = forms.CharField(max_length=500, required=False)


class DeliveryForm(forms.Form):
    fullName = forms.CharField(
        max_length=150,
        error_messages={"required": "Enter the recipient's name."},
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
    houseNumber = forms.CharField(
        max_length=26,
        error_messages={"required": "Enter the house number."},
    )
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

    def clean_fullName(self):
        # Stored as first and last name; everything after the first word is the last name.
        first, _, last = self.cleaned_data["fullName"].partition(" ")
        if len(first) > 50 or len(last.strip()) > 100:
            raise forms.ValidationError("This name is too long.")
        return self.cleaned_data["fullName"]

    def clean_houseNumber(self):
        match = re.fullmatch(r"(\d{1,6})\s*(.{0,20})", self.cleaned_data["houseNumber"])
        if match is None:
            raise forms.ValidationError("Enter the house number, for example 12 or 12B.")
        return self.cleaned_data["houseNumber"]

    def clean(self):
        cleaned = super().clean()
        pattern = POSTAL_CODE_PATTERNS.get(cleaned.get("country"))
        postal = cleaned.get("postalCode")
        if pattern and postal and not re.fullmatch(pattern[0], postal):
            self.add_error("postalCode", pattern[1])
        return cleaned

    # --- how the fields map onto the models ---------------------------------

    def customer_fields(self):
        first, _, last = self.cleaned_data["fullName"].partition(" ")
        return {
            "first_name": first,
            "last_name": last.strip(),
            "email": self.cleaned_data["email"],
            "phone": self.cleaned_data["phone"],
        }

    def address_fields(self):
        number, addition = re.fullmatch(
            r"(\d{1,6})\s*(.{0,20})", self.cleaned_data["houseNumber"]
        ).groups()
        return {
            "street_name": self.cleaned_data["street"],
            "house_number": int(number),
            "house_number_addition": addition.strip(),
            "postal_code": self.cleaned_data["postalCode"].upper(),
            "city": self.cleaned_data["city"],
            "country": COUNTRIES[self.cleaned_data["country"]],
        }
