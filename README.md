<span align="center">
<h1 align="center"><img src="https://raw.githubusercontent.com/oogje/homebridge-i6-bigAssFans/main/IMG_3799.jpg"/>
<img src="https://raw.githubusercontent.com/oogje/homebridge-i6-bigAssFans/main/HaikuH.jpg"/>
<img src="https://raw.githubusercontent.com/oogje/homebridge-i6-bigAssFans/main/es6.jpeg"/>
</h1>

## homebridge-i6-bigassfans (v0.6.0)

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
<!-- [![homebridge-miot](https://badgen.net/npm/v/homebridge-bigassfans-i6?icon=npm)](https://www.npmjs.com/package/homebridge-bigassfans-i6)
[![mit-license](https://badgen.net/npm/license/lodash)](https://github.com/oogje/homebridge-bigassfans-i6/blob/master/LICENSE)
<!-- [![follow-me-on-twitter](https://badgen.net/twitter/follow/merdok_dev?icon=twitter)](https://twitter.com/merdok_dev) -->
<!-- [![join-discord](https://badgen.net/badge/icon/discord?icon=discord&label=homebridge-xiaomi-fan)](https://discord.gg/AFYUZbk) -->
</span>

`homebridge-i6-bigassfans` is a plugin for Homebridge which allows you to control Big Ass Fans i6, es6, Haiku H/I Series and Haiku L Series
fans with firmware version 3.0 or greater.

The plugin name reflects that it was created to support, and was limited to, i6 model fans when no other homebridge
alternative was available. 
Some time around the beginning of April 2022, with a firmware update to the Haiku series fans, Big Ass Fans changed the Haiku's
communication protocol to be compatible with the i6 model, and therefore this plugin. 
Having access only to an i6 fan, I collaborated with Haiku fan owners (notably @pponce) to add support for their fans. 
The es6 model seems to work as well.

### **Bugs**

The network connection to the fan will reset on occasion.  I try to handle that gracefully but if it happens at the moment you
issue a command (e.g., turn on the light) as opposed to when the periodic probe message is issued, the command will be ignored.  Try again after two seconds.

Occasionally HomeKit will briefly show the light (if equipped) or the light auto switch (if configured) "on" even though it's actually off.


### **Features**

* Turn fan and/or light(s) on or off!
* Change speed, and direction (Keep in mind Big Ass Fans discourages reversing speed.)
* Ability to disable the fan direction control.
* Change brightness level of LED light.
* Control UV-C light
* Exposes Motion Sensors
* Display the fan's bluetooth remote's temperature and humidity sensors (i6 only).
* Display the fan's temperature sensors (Haiku Fans).
* Turn Whoosh Mode on or off.
* Turn Dim to Warm on or off (i6 Fans).
* Turn Fan Auto mode on or off.
* Turn Light Auto mode on or off.
* Turn Eco Mode on or off (Haiku fans).

### **Installation**

### Requirements

* Homebridge 1.8.0 up to (but not including) 3.0.0
* Node.js 18.20.4 or newer

Homebridge 2.x is fully supported.

If you are not already running homebridge you'll find how to install it in the homebridge [documentation](https://github.com/homebridge/homebridge#readme).  After you install homebridge you can install and configure the `homebridge-i6-bigassfans` plugin through `homebridge-config-ui-x` using a command line and editor as described below.

#### Install from published npm package

```sh
sudo npm install -g homebridge-i6-bigassfans
```

To install a specific pre-release version from npm, append the version after `@`. For example:

```sh
sudo npm install -g homebridge-i6-bigassfans@0.6.0-beta9
```

To install a specific fork
```sh
sudo npm install -g <github_username>/homebridge-i6-bigassfans
```

#### **Configuration**

Add the `BigAssFans-i6` platform in `config.json` in your home directory inside `.homebridge`.

Add your fan(s) in the `fans` array.

Example basic configuration:

```js
{
  "platforms": [
    {
      "platform": "BigAssFans-i6",
            "fans": [
                {
                    "name": "Big Fan i6",
                    "mac": "20:F8:5E:00:00:00",
                    "ip": "192.168.7.150"
                }
            ]
    }
  ]
}
```

Example configuration with optional params and multiple fans:

```js
{
  "platforms": [
    {
      "platform": "BigAssFans-i6",
              "fans": [
                  {
                    "name": "Big Fan i6",
                    "mac": "20:F8:5E:00:00:00",
                    "ip": "BigFani6.local",
                    "showFanAutoSwitch": true,
                    "showLightAutoSwitch": true,
                    "showWhooshSwitch": false,
                    "showDimToWarmSwitch": false
                  },
                  {
                    "name": "BigAssFans Haiku",
                    "mac": "20:F8:5E:00:00:01",
                    "ip": "192.168.1.151",
                    "showFanAutoSwitch": true,
                    "showLightAutoSwitch": true,
                    "showWhooshSwitch": true,
                    "showEcoModeSwitch": true
                   }
                ]
    }
  ]
}
```

#### Platform configuration fields

* `platform` [required]
Should always be **"BigAssFans-i6"**.
* `fans` [required]
A list of your fans.

#### General configuration fields

* `name` [required]
Name of your fan.
* `ip` [required]
IP address or hostname of your fan.  IP address can be found in the Big Ass Fans app's Wi-Fi settings screen.
* `mac` [required]
MAC address of your fan.  Can be found in the Big Ass Fans app's Wi-Fi settings screen.
* `showWhooshSwitch` [optional]
Adds accessory switch for Whoosh Mode (true/false, defaults to false).
* `showDimToWarmSwitch` [optional]
Adds accessory switch for Dim to Warm (true/false, defaults to false).
* `showFanAutoSwitch` [optional]
Adds accessory switch for the fan's Fan Auto mode (true/false, defaults to false).
* `showLightAutoSwitch` [optional]
Adds accessory switch for the fan's Light Auto mode (true/false, defaults to false).
* `showEcoModeSwitch` [optional]
Adds accessory switch for the fan's Eco mode (true/false, defaults to false).

#### Advanced Configuration Fields

* `probeFrequency` [optional]
Sets the frequency that probe messages are sent to the fan.  A frequency 0 milliseconds turns probing off (defaults to 60000 milliseconds).

#### Other Configuration Fields
* `noLights` [optional] Eliminates light switches (defaults to false)
* `showHumidity` [optional] Exposes humidity sensor (defaults to true)
* `showTemperature` [optional] Exposes temperature sensor (defaults to true).
* `downlightEquipped` [optional] Overrides downlight detection (defaults to undefined)

### **Other**

If you find you cannot change the fan icon in Apple's Home app and you are showing your fan with its lights and/or switches as a single tile, then show it as separate tiles.  That should unlock the icon so you can change it, then set it back to **Show as Single Tile** and the icon will be locked with your change in effect.

In some cases the Home app doesn't have the option to **Show as Separate Tiles** or **Show as Single Tile** in the Fan's settings, e.g. a Haiku H/I with no light and no optional switches being shown.  In this case the work-around is to add `"showTemperature": false` to your  config.json for the fan, restart, then change the icon, then remove the `"showTemperature"` line or change the setting to `true`, and restart.

### **Troubleshooting**

First, make sure you can control your fan from the official Big Ass Fans app.

If you have any issues with the plugin, you can run Homebridge in debug mode, which will provide some additional information. This may be useful for investigating problems.

Homebridge debug mode:

```sh
homebridge -D
```

Check out the [Issues](https://github.com/oogje/homebridge-i6-bigAssFans/issues?q=) (open and closed) for something relevant to the problem your experiencing.

Perhaps try running the most recent beta shown in the list of [npm versions](https://www.npmjs.com/package/homebridge-i6-bigassfans?activeTab=versions).  The [Release Notes](https://github.com/oogje/homebridge-i6-bigAssFans/blob/main/Release%20Notes.md) include tidbits about the betas.


## Special thanks

[@bdraco](https://github.com/bdraco) for suggesting BAF is using protobufs and [@jfroy](https://github.com/jfroy) for building a working BAF controller using protobufs.

[@pponce](https://github.com/pponce), without whom there would be no Haiku implementation and a lot less testing, and for generally being an awesome collaborator and for the Haiku photo.

All the users who reported issues and helped debug them, including [@aveach](https://github.com/aveach) who also made the es6 photo.  And users
like [@knmorgan](https://github.com/knmorgan) who discovered a bug and contributed the code to fix it.

[homebridge-miot](https://github.com/merdok/homebridge-miot) - whose style served as a guide.

[Bruce Pennypacker](https://bruce.pennypacker.org/2015/07/17/hacking-bigass-fans-with-senseme/) - whose blog provided some clarity.

[homebridge-bigAssFans](https://github.com/sean9keenan/homebridge-bigAssFans) - where the Haiku message protocol gave me some insight.

[HAP-NodeJS](https://github.com/KhaosT/HAP-NodeJS) & [homebridge](https://github.com/nfarina/homebridge) - for making this possible.

[Big Ass Fans](https://www.bigassfans.com) - for their awesome products many of which as of v3.3.1 natively support HomeKit!
