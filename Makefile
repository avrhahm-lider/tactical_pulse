.PHONY: run test seed simulate simulate-drones simulate-squads

run:
	./start.sh

seed:
	./start.sh --seed

test:
	cd backend && .venv/bin/pytest -v tests/test_api.py

simulate:
	backend/.venv/bin/python backend/simulator/run.py all --loop

simulate-drones:
	backend/.venv/bin/python backend/simulator/run.py drones --loop

simulate-squads:
	backend/.venv/bin/python backend/simulator/run.py squads --loop

