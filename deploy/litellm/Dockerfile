FROM ghcr.io/berriai/litellm-database:v1.101.0
COPY python/modelstill/dist/modelstill-0.1.0-py3-none-any.whl /tmp/
RUN pip install --no-cache-dir --no-deps /tmp/modelstill-0.1.0-py3-none-any.whl \
 && rm /tmp/modelstill-0.1.0-py3-none-any.whl \
 && python -c "import modelstill.serve.litellm_plugin"
