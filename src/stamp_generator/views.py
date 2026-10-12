from django.shortcuts import render

def index(request):
    return render(request, "stamp_generator/index.html")