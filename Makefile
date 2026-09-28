.PHONY: up down logs build native-app verify-native package-native verify-native-ui ctl verify-project

# Run the app as a local Docker-backed single-service stack.
# The Python FastAPI backend serves both API + static frontend in this mode.
up:
	@echo "Starting Scheduler stack with docker compose..."
	docker compose up -d --no-build

down:
	@echo "Stopping Scheduler stack..."
	docker compose down

logs:
	@echo "Tailing Scheduler logs..."
	docker compose logs -f

build:
	@echo "Building images and frontend bundle for Scheduler stack..."
	npm run build
	docker compose build

native-app:
	@echo "Building native macOS Scheduler app..."
	bash script/build_and_run.sh

verify-native:
	@echo "Verifying native macOS Scheduler app bundle..."
	bash script/build_and_run.sh --verify

package-native:
	@echo "Packaging native macOS Scheduler app..."
	bash script/build_and_run.sh --package

verify-native-ui:
	@echo "Running native macOS Scheduler UI audit..."
	node e2e/run-native-ui-audit.mjs

ctl:
	@node scripts/schedulerctl.mjs $(ARGS)

verify-project:
	@echo "Running Scheduler CLI-first project verification..."
	bash scripts/run_project_verification.sh
