## Release Notes 

## 0.4.3-beta1

### Bugs
Handle case where the length of a message was 0x22 bytes (as when a group name was exactly seven characters long).  Issue #8
Stop polling attempts if connection refused.
Log EHOSTDOWN connection error.
Fix debugLogs tag typo.

### Other
Include fan name in more log messages.

## 0.4.2

### Bugs
Eco Mode Switch had wrong description (Add a switch for 'Dim to Warm’) in configuration UI.  
No longer shows color temperature adjustment controls for Haiku H/I Series or Haiku L Series fans.  Issue #7

### Features
If configuring with *Homebridge UI*, by selecting a fan model, only relevant options will be presented.

### Other
Changed README and config.schema.json to note a hostname and IP address are interchangeable.  Issue #6
Added `showTemperature` configuration property for those who wish to turn off temperature reporting.  Issue #4