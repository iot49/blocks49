# MQTT

```bash
mosquitto_sub -h localhost -p 1883 -t rails49/live/predictions
```

Sample output:

```json
{
  "timestamp": 1767789464221,
  "layoutId": "da6e3ace-14ee-4918-8329-3d1406042da0",
  "markers": [
    { "id": "5b7039d6-9991-4501-98bc-bf204dd77b12", "prediction": "track" },
    { "id": "c4d08481-040b-4704-83be-4c37606e79ff", "prediction": "train" }
  ],
  "metrics": {
    "inferenceTimeMs": 31.63,
    "tTotMs": 33.91
  }
}
```