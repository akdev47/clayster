from django.shortcuts import render, get_object_or_404, redirect

from .models import Product

from .forms import ProductForm

def index(request):
    product_list = Product.objects.all()
    context = {"products": product_list}
    return render(request, "products/index.html", context)

def product(request, product_id):
    product = get_object_or_404(Product, pk=product_id)
    return render(request, "products/product.html", {"product": product})

def add(request):
    if request.method == "POST":
        form = ProductForm(request.POST)

        if form.is_valid():
            form.save()
            return redirect("products:index")
    else:
        form = ProductForm()

    return render(request, "products/add.html", {
        "form": form,
    })

def edit(request, product_id):
    product = get_object_or_404(Product, pk=product_id)

    if request.method == "POST":
        form = ProductForm(request.POST, instance=product)

        if form.is_valid():
            form.save()
            return redirect("products:product", product_id=product.id)

    else:
        form = ProductForm(instance=product)

    return render(request, "products/edit.html", {
        "form": form,
        "product": product,
    })


def delete(request, product_id):
    product = get_object_or_404(Product, id=product_id)

    if request.method == "POST":
        product.delete()

    return redirect("products:index")