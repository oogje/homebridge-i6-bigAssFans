## Release Notes

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