from django.contrib.admin.views.decorators import staff_member_required
from django.shortcuts import render, HttpResponse

from orders.models import Order

# if we only want users that are superuser:
# @user_passes_test(lambda u: u.is_superuser) 

@staff_member_required
def index(request):
    orders = (
        Order.objects.select_related("customer")
        .prefetch_related("items__product")
        .order_by("-placed_at")
    )
    return render(request, "dashboard/orders.html", {"orders": orders})

def oefenscherm(request):
    return HttpResponse("Oefenscherm. Oefenschikking.")

