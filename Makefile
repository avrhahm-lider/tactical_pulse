.PHONY: run test seed

run:
	./start.sh

seed:
	./start.sh --seed

test:
	cd backend && .venv/bin/pytest -v tests/test_api.py
