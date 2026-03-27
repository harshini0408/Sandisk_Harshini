from flask import Flask, jsonify, request
from flask_cors import CORS
import simulation_engine as engine

app = Flask(__name__)
CORS(app)

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "pillars": 4, "scenarios": 6})

@app.route("/api/state", methods=["GET"])
def get_state():
    return jsonify(engine.get_state())

@app.route("/api/reset", methods=["POST"])
def reset():
    state = engine.reset_state()
    return jsonify({"status": "reset", "blocks": len(state["blocks"])})

@app.route("/api/start-simulation", methods=["POST"])
def start_simulation():
    data = request.get_json(force=True)
    scenario_id = data.get("scenario", "BOOT").upper()
    result = engine.run_scenario(scenario_id)
    return jsonify(result)

@app.route("/api/events", methods=["GET"])
def get_events():
    return jsonify(engine.get_state()["event_log"])

if __name__ == "__main__":
    app.run(debug=True, port=5000)
