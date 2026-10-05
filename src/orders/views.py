from django.contrib.admin.views.decorators import staff_member_required
from django.shortcuts import get_object_or_404, redirect, render
from django.db import transaction
from products.utils import create_dummy_product
from .models import Order, OrderItem
from decimal import Decimal

from customers.models import Customer

from .forms import CheckoutForm

@transaction.atomic
def checkout(request):
    if request.method == "POST":
        form = CheckoutForm(request.POST)

        if form.is_valid():
            customer_info = form.save()
            product = create_dummy_product()
            quantity = 1
            subtotal = product.price*quantity
            shipping = Decimal("10.0")
            # create a dummy prodcut to display on dashboard
            order = Order.objects.create(
                customer=customer_info, 
                subtotal_price = subtotal,
                shipping_costs = shipping,
                total_price = shipping + subtotal,
                )
            
            order_item = OrderItem.objects.create(
                order = order,
                product = product,
                quantity = quantity,
                unit_price = product.price,
            )
            request.session["order_id"] = order.pk



            return redirect("orders:payment")
        
    else:
        form = CheckoutForm()

    return render(request, "orders/checkout.html", {"form": form})

def payment(request):
    order_id = request.session.get("order_id")

    if order_id is None:
        return redirect("orders:checkout")
    else:
        order = get_object_or_404(Order, pk=order_id)

    return render(request, "orders/payment.html", {"order": order})

@staff_member_required
def index(request):
    orders = (
        Order.objects.select_related("customer")
        .prefetch_related("items__product")
        .order_by("-created_at")
    )
    return render(request, "orders/index.html", {"orders": orders})
