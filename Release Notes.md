## Release Notes

### v0.6.1-beta3
- address issue #42

### v0.6.1-beta2
- attempt retries on ENETUNREACH

### v0.6.1-beta1
- insert code from @knmorgan to fix issue #38

### v0.6.0
- bug fixes, see v0.6.0 beta notes below

### v0.6.0-beta9
- 1st crack a handling night light/standbyLED
- stuffing messages sent to fan

### v0.6.0-beta8
- changes to handle fragmented messages - issue #30
- insert lightSelector at beginning of funStack

### v0.6.0-beta7
remove "both lights" control code in prep for v0.6.0 release

### v0.6.0-beta6
same as beta5 but different implementation.

### v0.6.0-beta5
not fully baked attempt to make a "both lights" control - issue #30

### v0.6.0-beta4
addresses a schedule parsing problem - issue #29

### v0.6.0-beta3
- Add this.debugLevels['capabilities']
- Log (info) if config.json conflicts with capabilities
- Clean up socket error handling code and most importantly…
- Call setTimeout with milliseconds instead of seconds
- redflag if currentTemperature() is called at all if not capable

### v0.6.0-beta2
- relies on fan's communicated capabilities to determine types and number of lights, sensors, etc.
- calls node's connect() with IPV4 family option to address issue #29
- Homebridge UI won't ask for the model anymore

### V0.6.0-beta1
incorporates recently discovered protocol field definitions,  This information will serve to reduce the amount of guesswork and coding gymnastics.  As an immediate consequence, the workaround for misidentifying the presence of a downlight (Issue #28) should now be unnecessary. 

### v0.5.4
- exposes UV-C light
- exposes motion sensors
- added `noLight` to hide light switches
- added `showHumidity` to enable hiding humidity sensor (`"showHumidity": false`)
- added `downlightEquipped` to override plugin's downlight detection
- bug fixes

### v0.5.4-beta11
added `"downlightEquipped"` and `"uplightEquipped"` config parameters which override the associated light's automatic detection.
`true` means there is a light, `false` means there isn't one.  See issue #28.
If you need to override a light to `true` because the plugin doesn't recognize it, please open an issue so we can collect more
data and try to fix the auto-detection code.

### v0.5.4-beta10
addresses beta9's inadequate attempt to address Issue #21's resolution
in order to do that, the hack that addressed Issue #17 was mostly removed - that hack ought to be unnecessary by now.
I trust someone will open an issue if it's not

### v0.5.4-beta9
humidity sensor can be disabled
addresses problem with Issue #21's resolution  - name changes don't survive a restart

### v0.5.4-beta8
added occupancy sensors

### v0.5.4-beta7
capped re-connect backoff, improved log text, changed some log levels

### v0.5.4-beta6
fix for beta5 insta-crash with Haiku

### v0.5.4-beta5
implement `"noLight"` configuration attribute

in the midst of implementing some sort of error retry backoff mechanism

### v0.5.4-beta4
Same as v0.5.4-beta3 with fix to remove zombie downlight and hack to send targetBulb for es6 with one light

### v0.5.4-beta3
Addresses Issue #20
>ignore message with field 17 sub-field 2 issued by an es6 fan.

>add UC-V switch when equipped.

set ConfiguredName to appease iOS/iPadOs 16.

if there aren't two lights, ignore targetBulb and use whichever bulbService is present.

### v0.5.4-beta2

This space intentionally left blank (because I removed it).

### v0.5.4-beta1
Deal with Issue #19.

### v0.5.3
Deals with Issue #17.

### v0.5.3-beta3
warning: this will remove the automations associated with the cached defunct light.

### v0.5.3-beta2
remove cached light left over from versions before dual light support.

### v0.5.3-beta1
issue advisory to log file about extra light

eliminated extra protobuf decode pass for detecting active bulb early

can change debugLevels via a tcp socket.  the socket number is shown in the log file upon start-up.
By default this feature is not enabled.  Setting `"enableDebugPort"` to `true` in json.config for a fan enables it for that fan.
example (newline alone lists current debugLevels):
```sh
$ nc localhost 52569
Big Fan

  light, 0
  cluing, 0
  network, 0
  newcode, 0
  humidity, 0
  progress, 0
  redflags, 1
  direction, 0
  noopcodes, 0
  protoparse, 0
  characteristics, 0
newcode, 1
newcode set to 1
newcode, 0
newcode set to 0
```

### v0.5.2
incorporates bug fixes and features from v05.2 betas

When updating from releases prior to v05.2-beta3, an extraneous light may appear.  To remove it, clear the cache.  See Issue #17.

### v0.5.2-beta4
addresses issue #16

### v0.5.2-beta3
handles multiple lights.  Issue #10

### v0.5.2-beta2
guessing how to recognize light presence on Haiku H/I Series Gen. 3 fan.  Issue #14

### v0.5.2-beta1
adds config attribute to ignore fan direction control `disableDirectionControl`.  Issue #13

### v0.5.1
same as v0.5.0-beta3 but with typo fixes in comments and nascent ideas for es6 support

### v0.5.0-beta3
addresses the bug described in Issue #9 where turning on Auto Light with `showAutoLight` configuration attribute `false` crashes homebridge

### v0.5.0-beta2
message parsing engine re-written taking into account message are formatted as Protocol Buffers - thanks to @bdraco for
suggesting protobufs and @jfroy for building a working implementation.

deprecating switch attribute names in config for more descriptive names.  E.g. `ecoMode` -> `showEcoModeSwitch`

### v0.4.3

### Bugs
Handle case where the length of a message was 0x22 bytes (as when a group name was exactly seven characters long).  Issue #8
Stop polling attempts if connection refused.
Log EHOSTDOWN connection error.
Fix debugLogs tag typo.

### Other
Include fan name in more log messages.

### v0.4.2

### Bugs
Eco Mode Switch had wrong description (Add a switch for 'Dim to Warm’) in configuration UI.  
No longer shows color temperature adjustment controls for Haiku H/I Series or Haiku L Series fans.  Issue #7

### Features
If configuring with *Homebridge UI*, by selecting a fan model, only relevant options will be presented.

### Other
Changed README and config.schema.json to note a hostname and IP address are interchangeable.  Issue #6
Added `showTemperature` configuration property for those who wish to turn off temperature reporting.  Issue #4