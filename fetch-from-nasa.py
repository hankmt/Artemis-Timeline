import requests, json, re

BASE_URL = "https://images-api.nasa.gov"

collection = {
    "photos": [],
    "audio": [],
    "video": []
}

def get_metadata(nasa_id: str, file: str, original: str):
    SETTINGS_SEPERATOR = "·"

    metadata_request = requests.get(f"{BASE_URL}/metadata/{nasa_id}")
    metadata_location = json.loads(metadata_request.text)['location']
    metadata_file = requests.get(metadata_location)
    metadata = json.loads(metadata_file.text)

    unformatted_time = metadata['EXIF:DateTimeOriginal'] if "EXIF:DateTimeOriginal" in metadata else metadata['AVAIL:DateCreated'] if "AVAIL:DateCreated" in metadata else ""
    unformatted_date, formatted_time = re.split(" |T", unformatted_time.replace("Z", ""))
    formatted_datetime = f"{unformatted_date.replace(':', '-')} {formatted_time}"

    data = {
        "time": formatted_datetime,
        "file": file.split("/")[-1],
        "file_url": file,
        "original_url": original,
        "photographer": metadata['EXIF:Artist'] if "EXIF:Artist" in metadata else metadata['AVAIL:Photographer'] if "AVAIL:Photographer" in metadata else "",
        "location": metadata['AVAIL:Location'],
        "camera": metadata['EXIF:Model'] if "EXIF:Model" in metadata else "",
        "settings": "", #f"{metadata['EXIF:FocalLength']} {SETTINGS_SEPERATOR} {metadata['EXIF:LensInfo']} {SETTINGS_SEPERATOR} {metadata['EXIF:ExposureTime']}s {SETTINGS_SEPERATOR} ISO {metadata['EXIF:ISO']} {SETTINGS_SEPERATOR} {None}",
        "spacecraft": True,
        "batch": 1,
        "title": metadata['AVAIL:Title'] if "AVAIL:Title" in metadata else "",
        "flickr_desc": metadata['AVAIL:Description'],
        "enabled": True
    }

    return data

album = "Artemis_II"
print(f"Getting items from album {album}")
album_request = requests.get(f"{BASE_URL}/album/{album}?media_type=image")
album_data = json.loads(album_request.text)
album_items = album_data['collection']['items']

for item in album_items:
    item_id = item['data'][0]['nasa_id']
    print(f"Found item {item_id}")

    file_links = sorted(item['links'], key = lambda link: 0 if "size" not in link else link['size'])
    metadata = get_metadata(item_id, file_links[-2]['href'], file_links[-1]['href'])

    with open(f"web/{metadata['file']}", "wb") as file:
        file.write(requests.get(metadata['file_url']).content)

    collection['photos'].append(metadata)

with open("photos.js", "w") as outfile:
    outfile.write(f"const PHOTO_DATA = {json.dumps(collection, indent = 4)}")
