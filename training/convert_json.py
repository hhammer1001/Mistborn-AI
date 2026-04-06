import json
import csv
from engine import DATA_DIR


def convert(name, category=False):
    with open(DATA_DIR / f"{name}.json") as f:
        data = json.load(f)
    if not category:
        with open(DATA_DIR / f"{name}.csv", "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["Name", "Net Score", "Uses", "Winrate"])
            for card, values in data.items():
                writer.writerow([card, *values])
    else: 
        with open(DATA_DIR / f"{name}.csv", "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["Name", "Net Score", "Uses", "Winrate"]*3)
            for i in range(len(data[list(data.keys())[0]].keys())):
                row = []
                for missionDict in data:
                    key = list(data[missionDict].keys())[i]
                    row += [key, *data[missionDict][key]]
                writer.writerow(row)


def unconvert(name, category=False):
    if not category:
        data = {}

        with open(DATA_DIR / f"{name}.csv", newline="") as f:
            reader = csv.reader(f)
            next(reader)  # skip header

            for row in reader:
                card = row[0]
                values = [
                    int(row[1]),      # Uses
                    float(row[2]),    # Net Score
                    float(row[3])     # Winrate
                ]
                data[card] = values

        with open(DATA_DIR / f"{name}.json", "w") as f:
            json.dump(data, f, indent=2)


    else:
        with open(DATA_DIR / f"{name}.csv", newline="") as f:
            reader = csv.reader(f)
            header = next(reader)

            num_categories = len(header) // 4
            categories = [{} for _ in range(num_categories)]

            for row in reader:
                for i in range(num_categories):
                    offset = i * 4
                    card = row[offset]
                    values = [
                        int(row[offset + 1]),
                        float(row[offset + 2]),
                        float(row[offset + 3])
                    ]
                    categories[i][card] = values

        # Match original structure: { mission: { card: [values] } }
        data = {}
        for i, cat in enumerate(categories):
            data[f"mission_{i}"] = cat

        with open(DATA_DIR / f"{name}.json", "w") as f:
            json.dump(data, f, indent=2)

# convert('wins2')
# convert('syns2')
# convert('categor2', True)

# unconvert('wins2')
# unconvert('syns2')
# unconvert('categor2', True)

for char in ['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy']:
    convert(char+"3")