from django.shortcuts import get_object_or_404, redirect, render

from customers.models import Customer

from .forms import CheckoutForm

def checkout(request):
    if request.method == "POST":
        form = CheckoutForm(request.POST)

        if form.is_valid():
            customer_info = form.save()
            request.session["customer_id"] = customer_info.pk

            return redirect("orders:payment")
        
    else:
        form = CheckoutForm()

    return render(request, "orders/checkout.html", {"form": form})

