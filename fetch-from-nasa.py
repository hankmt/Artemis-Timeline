#!/usr/bin/env python3

## Created by Michael Rice (xcalibur839). Version 1.0 created on 2026-05-16
##
## This Python script will attempt to download all images (TODO: audio, video) directly from the public NASA API, including metadata. Once the files have been
## downloaded to the web/ folder, the metadata will be saved to photos.js.
##
## In order to use this script, you will need to install the dependencies with `pip install -r requirements.txt` and add your NASA API Token to a file called
## .env with the content TOKEN=YourToken
##
## A NASA API Token is free, and can be obtained from https://api.nasa.gov/

# Import internal libraries and external dependencies
import json, re, os
import requests
from dotenv import dotenv_values
from tqdm import tqdm

# Define base constants and variables that will be used throughout the script

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

# Define functions that will be used throughout the script

# Get the ceiling of a division. e.g. 5/3 = 2 (1.66.. rounded up)
def ceil(numerator: int, demoninator: int):
    return -(numerator // -demoninator)

# Extract the date and time from the metadata and format it to align with the expected format for photos.js
def format_datetime(metadata: json):
    unformatted_time = ""
    unformatted_date = ""
    formatted_time = ""
    formatted_date = ""
    formatted_datetime = ""

    if "AVAIL:DateCreated" in metadata and len(metadata['AVAIL:DateCreated']) > len(unformatted_time):
        unformatted_time = metadata['AVAIL:DateCreated']
    if "EXIF:DateTimeOriginal" in metadata and len(metadata['EXIF:DateTimeOriginal']) > len(unformatted_time):
        unformatted_time = metadata['EXIF:DateTimeOriginal']
    if "XMP:CreateDate" in metadata and len(metadata['XMP:CreateDate']) > len(unformatted_time):
        unformatted_time = metadata['XMP:CreateDate']
    if "XMP:DateCreated" in metadata and len(metadata['XMP:DateCreated']) > len(unformatted_time):
        unformatted_time = metadata['XMP:DateCreated']

    if (" " in unformatted_time and ":" in unformatted_time) or "T" in unformatted_time:
        if "-" in unformatted_time:
            strip_tz = re.search(".*?(?=-\d\d:\d\d)", unformatted_time)
            if strip_tz and not "-" in strip_tz.group(0):
                unformatted_time = strip_tz.group(0)
        unformatted_date, formatted_time = re.split(" |T", unformatted_time.replace("Z", ""))
    
    if ":" in unformatted_date:
        formatted_date = unformatted_date.replace(':', '-')
    else:
        formatted_date = unformatted_date

    if formatted_date != "" and formatted_time != "":
        formatted_datetime = f"{formatted_date} {formatted_time}"
    
    return formatted_datetime

# Extract the camera settings from the metadata and format it to align with the expected format for photos.js
def format_camera_settings(metadata: json):
    SETTINGS_SEPERATOR = "·"
    settings = ""

    focal_length = ""
    if "EXIF:FocalLength" in metadata and len(metadata['EXIF:FocalLength']) > len(focal_length):
        focal_length = metadata['EXIF:FocalLength']
    # ...

    lens_info = ""
    if "EXIF:LensInfo" in metadata and len(metadata['EXIF:LensInfo']) > len(lens_info):
        lens_info = metadata['EXIF:LensInfo']
    # ...

    exposure_time = ""
    if "EXIF:ExposureTime" in metadata and len(str(metadata['EXIF:ExposureTime'])) > len(exposure_time):
        exposure_time = f"{metadata['EXIF:ExposureTime']}s"
    # ...

    iso = ""
    if "EXIF:ISO" in metadata and len(str(metadata['EXIF:ISO'])) > len(iso):
        iso = f"ISO {metadata['EXIF:ISO']}"
    # ...

    settings = f" {SETTINGS_SEPERATOR} ".join((focal_length, lens_info, exposure_time, iso))
    return settings

# Get the metadata for a specific nasa_id item from NASA's metadata API endpoint
def get_metadata(nasa_id: str, file: str, original: str):
    metadata_request = session.get(f"{BASE_URL}/metadata/{nasa_id}", headers = headers)
    metadata_location = json.loads(metadata_request.text)['location']
    metadata_file = session.get(metadata_location, headers = headers)
    metadata = json.loads(metadata_file.text)

    data = {
        "time": format_datetime(metadata),
        "file": file.split("/")[-1],
        "file_url": file,
        "original_url": original,
        "photographer": metadata['EXIF:Artist'] if "EXIF:Artist" in metadata else metadata['AVAIL:Photographer'] if "AVAIL:Photographer" in metadata else "",
        "location": metadata['AVAIL:Location'],
        "camera": metadata['EXIF:Model'] if "EXIF:Model" in metadata else "",
        "settings": format_camera_settings(metadata),
        "spacecraft": True,
        "batch": 1,
        "title": metadata['AVAIL:Title'] if "AVAIL:Title" in metadata else "",
        "flickr_desc": metadata['AVAIL:Description'],
        "enabled": True
    }

    return data

# Get all items from a page provided by NASA's API
def get_page_items(items: list):
    for item in tqdm(items, desc = "Page items downloaded", unit = "item", leave = False):
        item_id = item['data'][0]['nasa_id']

        if "links" not in item:
            continue

        file_links = sorted(item['links'], key = lambda link: 0 if "size" not in link else link['size'])

        if len(file_links) > 1:
            metadata = get_metadata(item_id, file_links[-2]['href'], file_links[-1]['href'])
        else:
            metadata = get_metadata(item_id, file_links[-1]['href'], file_links[-1]['href'])

        if metadata['time'][:7] != "2026-04":
            continue

        if not os.path.exists(f"web/{metadata['file']}"):
            with open(f"web/{metadata['file']}", "wb") as file:
                file.write(session.get(metadata['file_url'], headers = headers).content)

        collection['photos'].append(metadata)

# Begin script execution

# Specify the album name
album = "Artemis_II"
print(f"Getting pages of items from album {album}")

# Get the first page of data and calculate the page count
album_request = session.get(f"{BASE_URL}/album/{album}?media_type=image", headers = headers)
album_data = json.loads(album_request.text)
page_count = ceil(album_data['collection']['metadata']['total_hits'], 100)

# Get the data from every item on the page. If there is a next page, repeat for that page as well
for page_num in tqdm(range(2, page_count + 2), desc = "Pages downloaded", unit = "page"):
    get_page_items(album_data['collection']['items'])
    album_request = session.get(f"{BASE_URL}/album/{album}?page={page_num}&media_type=image", headers = headers)
    album_data = json.loads(album_request.text)

# Now that all images and metadata have been collected, save the metadata to photos.js in the expected format
with open("photos.js", "w") as outfile:
    outfile.write(f"const PHOTO_DATA = {json.dumps(collection, indent = 4)}")
