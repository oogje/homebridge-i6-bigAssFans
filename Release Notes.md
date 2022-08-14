## Release Notes

## v0.5.2-beta2
guessing how to recognize light presence on Haiku H/I Series Gen 3 fan.  Issue #14

## v0.5.2-beta1
adds config attribute to ignore fan direction control `disableDirectionControl`

## v0.5.1
same as v0.5.0-beta3 but with typo fixes in comments and nascent ideas for es6 support

## v0.5.0-beta3
addresses the bug described in Issue #9 where turning on Auto Light with `showAutoLight` configuration attribute `false` crashes homebridge

## v0.5.0-beta2
message parsing engine re-written taking into account message are formatted as Protocol Buffers - thanks to @bdraco for
suggesting protobufs and @jfroy for building a working implementation.

deprecating switch attribute names in config for more descriptive names.  E.g. `ecoMode` -> `showEcoModeSwitch`

## v0.4.3

### Bugs
Handle case where the length of a message was 0x22 bytes (as when a group name was exactly seven characters long).  Issue #8
Stop polling attempts if connection refused.
Log EHOSTDOWN connection error.
Fix debugLogs tag typo.

### Other
Include fan name in more log messages.

## v0.4.2

### Bugs
Eco Mode Switch had wrong description (Add a switch for 'Dim to Warm’) in configuration UI.  
No longer shows color temperature adjustment controls for Haiku H/I Series or Haiku L Series fans.  Issue #7

### Features
If configuring with *Homebridge UI*, by selecting a fan model, only relevant options will be presented.

### Other
Changed README and config.schema.json to note a hostname and IP address are interchangeable.  Issue #6
Added `showTemperature` configuration property for those who wish to turn off temperature reporting.  Issue #4