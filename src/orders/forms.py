import re

from django import forms

from .pricing import COUNTRIES, MAX_QUANTITY

# The field names are the ones the stamp generator's order page uses, so the
# errors returned by the API can be shown next to the right input as they are.

POSTAL_CODE_PATTERNS = {
    "NL": (r"^\d{4}\s?[A-Za-z]{2}$", "Gebruik het formaat 1234 AB."),
    "BE": (r"^\d{4}$", "Gebruik een postcode van 4 cijfers."),
    "DE": (r"^\d{5}$", "Gebruik een postcode van 5 cijfers."),
    "FR": (r"^\d{5}$", "Gebruik een postcode van 5 cijfers."),
}

QUANTITY_ERROR = f"Het aantal moet een geheel getal van 1 tot {MAX_QUANTITY} zijn."


class OrderDetailsForm(forms.Form):
    title = forms.CharField(
        max_length=80,
        error_messages={"required": "Geef de stempel een naam."},
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
        error_messages={"required": "Vul de voornaam in."},
    )
    lastName = forms.CharField(
        max_length=100,
        error_messages={"required": "Vul de achternaam in."},
    )
    email = forms.EmailField(
        max_length=254,
        error_messages={
            "required": "Vul een geldig e-mailadres in.",
            "invalid": "Vul een geldig e-mailadres in.",
        },
    )
    phone = forms.CharField(max_length=20, required=False)
    street = forms.CharField(max_length=100, error_messages={"required": "Vul de straat in."})
    # The number is an integer in the database; letters go in the addition.
    houseNumber = forms.CharField(
        max_length=5,
        error_messages={"required": "Vul het huisnummer in."},
    )
    houseNumberAddition = forms.CharField(max_length=20, required=False)
    postalCode = forms.CharField(
        max_length=10,
        error_messages={"required": "Vul de postcode in."},
    )
    city = forms.CharField(max_length=100, error_messages={"required": "Vul de plaats in."})
    country = forms.ChoiceField(
        choices=list(COUNTRIES.items()),
        error_messages={
            "required": "Kies een land.",
            "invalid_choice": "Kies een land.",
        },
    )

    def clean_phone(self):
        phone = self.cleaned_data["phone"]
        if phone and not re.fullmatch(r"[+()\d\s-]{6,20}", phone):
            raise forms.ValidationError("Gebruik alleen cijfers, spaties, + ( ) of -.")
        return phone

    def clean_houseNumber(self):
        number = self.cleaned_data["houseNumber"]
        if not re.fullmatch(r"[1-9]\d{0,4}", number):
            raise forms.ValidationError("Gebruik alleen cijfers; zet letters zoals A bij de toevoeging.")
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
