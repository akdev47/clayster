import random

from django.contrib.admin.views.decorators import staff_member_required
from django.db import transaction
from django.shortcuts import HttpResponse, redirect, render
from django.views.decorators.http import require_POST

from customers.models import Customer
from orders.models import Order, OrderItem
from products.utils import create_dummy_product

# if we only want users that are superuser:
# @user_passes_test(lambda u: u.is_superuser) 

@staff_member_required
def index(request):
    orders = (
        Order.objects.select_related("customer")
        .prefetch_related("items__product")
        .order_by("-created_at")
    )
    return render(request, "dashboard/orders.html", {"orders": orders})

def oefenscherm(request):
    return HttpResponse("Oefenscherm. Oefenschikking.")

@staff_member_required
@require_POST
@transaction.atomic
def create_dummy_order(request):
    dummy_customer, _ = Customer.objects.get_or_create(
        email="JohnDoe@dummy.mail.com",
        defaults= {
            "first_name": "John",
            "last_name": "Doe",
        },
        )

    order = Order.objects.create(
        customer=dummy_customer,
        order_status = "WA",
        delivery_notes = "Leave at the door",
        subtotal_price = 10,
        shipping_costs = 10,
        total_price = 20,
    )

    product = create_dummy_product()

    orderItem = OrderItem.objects.create(
        order=order,
        product=product,
        unit_price = 10
    )

    return redirect("index")