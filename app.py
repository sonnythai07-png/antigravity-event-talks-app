import time
import urllib.request
import xml.etree.ElementTree as ET
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Cache configuration
FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
CACHE_TTL = 300  # Cache for 5 minutes (in seconds)
cache = {
    "data": None,
    "last_fetched": 0
}

def parse_atom_feed(xml_data):
    try:
        root = ET.fromstring(xml_data)
    except Exception as e:
        print(f"Error parsing XML: {e}")
        return []
    
    # Google feeds use the Atom namespace
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    
    entries = []
    entry_elements = root.findall('atom:entry', ns)
    for entry in entry_elements:
        title = entry.find('atom:title', ns)
        updated = entry.find('atom:updated', ns)
        entry_id = entry.find('atom:id', ns)
        content = entry.find('atom:content', ns)
        
        # Link extraction
        link_el = entry.find('atom:link', ns)
        link = ""
        if link_el is not None:
            link = link_el.attrib.get('href', '')
            
        entries.append({
            'title': title.text if title is not None else '',
            'updated': updated.text if updated is not None else '',
            'id': entry_id.text if entry_id is not None else '',
            'content': content.text if content is not None else '',
            'link': link
        })
    return entries

def fetch_feed():
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    req = urllib.request.Request(FEED_URL, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as response:
        return response.read()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/releases')
def get_releases():
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    current_time = time.time()
    
    # Check if cache is valid
    if not force_refresh and cache["data"] is not None and (current_time - cache["last_fetched"]) < CACHE_TTL:
        print("Returning cached feed data.")
        return jsonify({
            "source": "cache",
            "last_fetched": cache["last_fetched"],
            "entries": cache["data"]
        })
    
    # Fetch and parse
    try:
        print("Fetching fresh feed data...")
        xml_data = fetch_feed()
        entries = parse_atom_feed(xml_data)
        
        # Update cache
        cache["data"] = entries
        cache["last_fetched"] = current_time
        
        return jsonify({
            "source": "network",
            "last_fetched": current_time,
            "entries": entries
        })
    except Exception as e:
        # Fallback to cache if network call fails
        if cache["data"] is not None:
            print(f"Network fetch failed. Returning cached data. Error: {e}")
            return jsonify({
                "source": "fallback_cache",
                "last_fetched": cache["last_fetched"],
                "entries": cache["data"],
                "error": str(e)
            })
        else:
            print(f"Network fetch failed and no cache available. Error: {e}")
            return jsonify({
                "error": "Failed to fetch release notes feed",
                "details": str(e)
            }), 500

if __name__ == '__main__':
    # Run server locally
    app.run(debug=True, host='127.0.0.1', port=5000)
