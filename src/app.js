import fs from 'fs';
import fetch from 'node-fetch';
import mqtt from 'mqtt';

let config;
let mqttClient;
let lastNotificationDate;
let tagsMap;
let supervisorToken;

async function initialize() {
  const configFile = fs.readFileSync('./data/options.json', 'utf-8');
  config = JSON.parse(configFile);
  tagsMap = new Map();
  if (config.ntfy_user && config.ntfy_password) {
    config.ntfy_basicAuth = `Basic ${Buffer.from(config.ntfy_user + ':' + config.ntfy_password, 'utf8').toString('base64')}`;
  } else if (config.ntfy_token) {
    config.ntfy_token = `Bearer ${config.ntfy_token}`;
  }
  config.ntfy_tags.forEach(tag => {
    tagsMap.set(tag.object, tag.tags);
  });
  supervisorToken = process.env.TOKEN;
  try {
    const mqttOptions = {};
    mqttOptions.port = config.mqtt_port;
    if (config.mqtt_username && config.mqtt_username !== '') {
      mqttOptions.username = config.mqtt_username;
    }
    if (config.mqtt_password && config.mqtt_password !== '') {
      mqttOptions.password = config.mqtt_password;
    }
    mqttClient = mqtt.connect(config.mqtt_address, mqttOptions);
    mqttClient.on('connect', options => {
      mqttClient.subscribe([config.mqtt_topic], () => {
        console.log(`Connected to MQTT at '${config.mqtt_address}'`);
        console.log(`Subscribed to topic '${config.mqtt_topic}'`);
      });
    });
    mqttClient.on('message', (topic, payload) => {
      const event = JSON.parse(payload.toString());
      const before = event.before;
      const after = event.after;
      const type = event.type;
      if (!before?.has_snapshot && after?.has_snapshot) {
        sendNotification(after.camera, after.label, after.id);
      }
    });
  } catch (e) {
    console.error(`Error connecting to MQTT broker at ${config.mqtt_address}: ${e}`);
  }
}

function sendNotification(camera, label, id) {
  if (config.ntfy_enabled) {
    sendNtfyNotification(camera, label, id);
  }
  if (config.ha_enabled) {
    config.ha_entity_ids.forEach(entityId => {
      sendHaNotification(camera, label, id, entityId);
    });
  }
  if (config.pushover_enabled) {
    sendPushoverNotification(camera, label, id);
  }
}

function sendNtfyNotification(camera, label, id) {
  let priority = config.ntfy_normal_priority;
  if (config.grouping_enabled) {
    const now = new Date();
    if (lastNotificationDate) {
      const diff = now - lastNotificationDate
      const diffMinutes = Math.floor(diff / 60000);
      if (diffMinutes >= config.grouping_minutes) {
        lastNotificationDate = now;
      } else {
        priority = config.ntfy_lower_priority;
      }
    } else {
      lastNotificationDate = now;
    }
  }
  const options = {
    method: 'POST',
    headers: {
      'Title': capitalizeFirstLetter(label),
      'Attach': `${config.frigate_url}/api/events/${id}/snapshot.jpg${formatSnapshotOptions()}`,
      'Click': `${config.frigate_url}/api/events/${id}/clip.mp4`,
      'Tags': tagsMap.get(label),
      'Priority': priority
    },
    body: capitalizeFirstLetter(camera)
  };
  if (config.ntfy_basicAuth) {
    options.headers.Authorization = config.ntfy_basicAuth;
  } else if (config.ntfy_token) {
    options.headers.Authorization = config.ntfy_token;
  }
  fetch(`${config.ntfy_url}/${config.ntfy_topic}`, options)
      .then(response => {
        if (response.status !== 200) {
          console.error(`Non-successful response from ntfy request: ${response.status} ${response.statusText}`);
        }
      })
      .catch(error => console.error(`Error sending request to ntfy at ${config.ntfy_url}:`, error));
}

function sendHaNotification(camera, label, id, entityId) {
  const body = {
    title: capitalizeFirstLetter(label),
    message: capitalizeFirstLetter(camera),
    data: {
      image: `${config.frigate_url}/api/events/${id}/snapshot.jpg${formatSnapshotOptions()}`,
      clickAction: `${config.frigate_url}/api/events/${id}/clip.mp4`
    }
  }
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supervisorToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
  fetch(`http://supervisor/core/api/services/notify/${entityId}`, options)
      .then(response => {
        if (response.status !== 200) {
          console.error(`Non-successful response from Home Assistant API request: ${response.status} ${response.statusText}`);
        }
      })
      .catch(error => console.error(`Error sending request to Home Assistant:`, error));
}

function sendPushoverNotification(camera, label, id) {
  const body = {
    token: config.pushover_api_token,
    user: config.pushover_user_key,
    message: capitalizeFirstLetter(camera),
    title: capitalizeFirstLetter(label),
    priority: config.pushover_priority,
    url: `${config.frigate_url}/api/events/${id}/clip.mp4`,
    url_title: 'View Clip',
    attachment: `${config.frigate_url}/api/events/${id}/snapshot.jpg${formatSnapshotOptions()}`
  };
  const options = {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
  fetch('https://api.pushover.net/1/messages.json', options)
      .then(response => {
        if (response.status !== 200) {
          console.error(`Non-successful response from Pushover API request: ${response.status} ${response.statusText}`);
        }
      })
      .catch(error => console.error(`Error sending request to Pushover:`, error));
}

function formatSnapshotOptions() {
  return config.snapshot_options ?
      '?' + Object.entries(config.snapshot_options)
          .map(([key, value]) => `${key}=${value}`)
          .join('&') :
      '';
}

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

initialize().then();
