import json, re
import requests
from dotenv import dotenv_values
from tqdm import tqdm

BASE_URL = "https://images-api.nasa.gov"
config = dotenv_values()

headers = {
    "Authorization": f"Bearer {config['TOKEN']}"
}

session = requests.Session()

collection = {
    "photos": [],
    "audio": [],
    "video": []
}

def ceil(numerator: int, demoninator: int):
    return -(numerator // -demoninator)

def get_metadata(nasa_id: str, file: str, original: str):
    SETTINGS_SEPERATOR = "·"

    metadata_request = session.get(f"{BASE_URL}/metadata/{nasa_id}", headers = headers)
    metadata_location = json.loads(metadata_request.text)['location']
    metadata_file = session.get(metadata_location, headers = headers)
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

def get_page_items(items: list):
    for item in tqdm(items, desc = "Getting page items", unit = "item", leave = False, ascii = True):
        item_id = item['data'][0]['nasa_id']

        if "links" not in item:
            continue

        file_links = sorted(item['links'], key = lambda link: 0 if "size" not in link else link['size'])
        metadata = get_metadata(item_id, file_links[-2]['href'], file_links[-1]['href'])

        with open(f"web/{metadata['file']}", "wb") as file:
            file.write(session.get(metadata['file_url'], headers = headers).content)

        collection['photos'].append(metadata)

# Begin execution
album = "Artemis_II"
print(f"Getting pages of items from album {album}")

album_request = session.get(f"{BASE_URL}/album/{album}?media_type=image", headers = headers)
album_data = json.loads(album_request.text)
page_count = ceil(album_data['collection']['metadata']['total_hits'], 100)

for page_num in tqdm(range(2, page_count + 1), desc = "Getting pages data", initial = 1, unit = "page", ascii = True):
    get_page_items(album_data['collection']['items'])
    album_request = session.get(f"{BASE_URL}/album/{album}?page={page_num}&media_type=image", headers = headers)
    album_data = json.loads(album_request.text)

with open("photos.js", "w") as outfile:
    outfile.write(f"const PHOTO_DATA = {json.dumps(collection, indent = 4)}")
