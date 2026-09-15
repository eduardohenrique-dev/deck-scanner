"""Pool de threads para identificar vários recortes em paralelo dentro de uma requisição.

OpenCV e NumPy liberam o GIL; o ganho maior vem das esperas de rede (imagem oficial para ORB,
modelo multimodal). Em função serverless com 1 vCPU o pool pequeno evita disputa inútil.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from . import config

identify_pool = ThreadPoolExecutor(max_workers=4 if config.SERVERLESS else 6, thread_name_prefix="identify")
