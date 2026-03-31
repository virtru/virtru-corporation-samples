.PHONY: help venv install activate shell sample_list clean

VENV_DIR ?= .venv
PYTHON ?= python3
PIP := $(VENV_DIR)/bin/pip
VENV_PY := $(VENV_DIR)/bin/python

help:
	@echo "Targets:"
	@echo "  make venv      - Create virtualenv and install boto3"
	@echo "  make install   - Install/upgrade boto3 in the virtualenv"
	@echo "  make shell     - Start a subshell with the venv activated"
	@echo "  make sample_list - Run sample_secure_object_proxy.py using the venv"
	@echo "  make activate  - Print the activation command"
	@echo "  make clean     - Remove the virtualenv"

$(VENV_DIR)/bin/activate:
	$(PYTHON) -m venv $(VENV_DIR)
	$(PIP) install --upgrade pip

venv: $(VENV_DIR)/bin/activate install

install: $(VENV_DIR)/bin/activate
	$(PIP) install --upgrade boto3 requests jwt

sample_list: install
	$(VENV_PY) sample_secure_object_proxy.py

activate: $(VENV_DIR)/bin/activate
	@echo "Run: source $(VENV_DIR)/bin/activate"

shell: $(VENV_DIR)/bin/activate
	@echo "Starting a subshell with the venv activated. Exit to return."
	@bash --noprofile --norc -c "source $(VENV_DIR)/bin/activate && exec \"$$SHELL\""

clean:
	rm -rf $(VENV_DIR)
