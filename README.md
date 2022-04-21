<span align="center">
<h1 align="center"><img src="https://raw.githubusercontent.com/oogje/homebridge-i6-bigAssFans/main/IMG_3799.jpg"/>
<img src="https://raw.githubusercontent.com/oogje/homebridge-i6-bigAssFans/main/HaikuH.jpg"/>
</h1>

## homebridge-i6-bigassfans

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
<!-- [![homebridge-miot](https://badgen.net/npm/v/homebridge-bigassfans-i6?icon=npm)](https://www.npmjs.com/package/homebridge-bigassfans-i6)
[![mit-license](https://badgen.net/npm/license/lodash)](https://github.com/oogje/homebridge-bigassfans-i6/blob/master/LICENSE)
<!-- [![follow-me-on-twitter](https://badgen.net/twitter/follow/merdok_dev?icon=twitter)](https://twitter.com/merdok_dev) -->
<!-- [![join-discord](https://badgen.net/badge/icon/discord?icon=discord&label=homebridge-xiaomi-fan)](https://discord.gg/AFYUZbk) -->

</span>

## `The following text refers to the betas, not the latest release`.

`homebridge-i6-bigassfans` is a plugin for Homebridge which allows you to control Big Ass Fans i6, Haiku H/I Series and Haiku L Series fans.

The plugin name reflects that it was created to support, and was limited to, i6 model fans when no other homebridge
alternative was available. 
Some time around the beginning of April 2022, with a firmware update to the Haiku series fans, BigAssFans changed the Haiku's
communication protocol to be compatible with the i6 model, and therefore this plugin. 
Having access only to an i6 fan, I collaborated with Haiku fan owners (notably @pponce) to add support for their fans. 
I've guessed the format of the binary protocol and of the approximately eighty unique message types I've seen, I think I know what about half of them mean. 

### **Bugs**

The network connection to the fan will reset on occasion.  I try to handle that gracefully but if it happens at the moment you
issue a command (e.g., turn on the light) as opposed to when the periodic probe message is issued, the command will be ignored.  Try again after two seconds.

Occasionally HomeKit will briefly show the light (if equipped) or the light auto switch (if configured) "on" even though it's actually off.


### **Features**

* Turn fan and/or light on or off!
* Change speed, and direction (Keep in mind Big Ass Fans discourages reversing speed.)
* Change brightness level of LED light.
* Display the fan's bluetooth remote's temperature and humidity sensors (i6 only).
* Display the fan's temperature sensors (Haiku Fans).
* Turn Whoosh Mode on or off.
* Turn Dim to Warm on or off.
* Turn Fan Auto mode on or off.
* Turn Light Auto mode on or off.
* Turn on Eco Mode (Haiku fans only).

### **Installation**

If you are not already running homebridge you'll find how to install it in the homebridge [documentation](https://github.com/homebridge/homebridge#readme).  After you install homebridge you can install and configure the `homebridge-i6-bigassfans` plugin through `homebridge-config-ui-x` using a command line and editor as described below.

#### Install homebridge-i6-bigassfans:

```sh
sudo npm install -g homebridge-i6-bigassfans
```
To install a pre-release version, append it to the package name after '@'.  For example:
```
sudo npm install -g homebridge-i6-bigassfans@0.3.20-beta.2
```

#### **Configuration**

Add the `BigAssFans-i6` platform in `config.json` in your home directory inside `.homebridge`.

Add your fan(s) in the `fans` array.

Example configuration simple:

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
                    "ip": "192.168.1.150",
                    "fanAuto": true,
                    "lightAuto": true,
                    "whoosh": false,
                    "dimToWarm": false
                  },
                  {
                    "name": "BigAssFans Haiku",
                    "mac": "20:F8:5E:00:00:01",
                    "ip": "192.168.1.151",
                    "fanAuto": true,
                    "lightAuto": true,
                    "whoosh": true,
                    "ecoMode": true
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
IP address of your fan.  Can be found in the Big Ass Fans app's Wi-Fi settings screen.
* `mac` [required]
MAC address of your fan.  Can be found in the Big Ass Fans app's Wi-Fi settings screen.
* `whoosh` [optional]
Adds accessory switch for Whoosh Mode (true/false)
* `dimToWarm` [optional]
Adds accessory switch for Dim to Warm (true/false)
* `fanAuto` [optional]
Adds accessory switch for the fan's Fan Auto mode (true/false)
* `lightAuto` [optional]
Adds accessory switch for the fan's Light Auto mode (true/false)
* `ecoMode` [optional]
Adds accessory switch for the fan's Eco mode (true/false)

### **Troubleshooting**

First, make sure you can control your fan from the official Big Ass Fans app.

If you have any issues with the plugin, you can run Homebridge in debug mode, which will provide some additional information. This may be useful for investigating issues.

Homebridge debug mode:

```sh
homebridge -D
```

## Special thanks

[homebridge-miot](https://github.com/merdok/homebridge-miot) - whose style served as a guide.

[Bruce Pennypacker](https://bruce.pennypacker.org/2015/07/17/hacking-bigass-fans-with-senseme/) - whose blog provided some clarity.

[homebridge-bigAssFans](https://github.com/sean9keenan/homebridge-bigAssFans) - where the Haiku message protocol gave me some insight.

[HAP-NodeJS](https://github.com/KhaosT/HAP-NodeJS) & [homebridge](https://github.com/nfarina/homebridge) - for making this possible.

[Big Ass Fans](https://www.bigassfans.com) - who I hope is working on their HomeKit implementation.
