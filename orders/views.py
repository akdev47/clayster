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

def payment(request):
    customer_id = request.session.get("customer_id")

    if customer_id is None:
        return redirect("orders:checkout")
    else:
        customer = get_object_or_404(Customer, pk=customer_id)

    return render(request, "orders/payment.html", {"customer": customer})