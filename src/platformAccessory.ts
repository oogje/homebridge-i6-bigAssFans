/* eslint-disable no-multi-spaces */

import { Service, PlatformAccessory, CharacteristicValue, Logger } from 'homebridge';
import { BigAssFans_i6Platform } from './platform';

// https://stackoverflow.com/questions/38875401/getting-error-ts2304-cannot-find-name-buffer
declare const Buffer; // this seems to ward off typescripts whining about buffer methods such as length, etc.

let hbLog: Logger;

const MAXFANSPEED = 7;

const ONEBYTEHEADER = [0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03];

const MODEL_i6 =       'i6';
const MODEL_HAIKU_L =  'Haiku L Series';
const MODEL_HAIKU_HI = 'Haiku H/I Series';

export class BigAssFans_i6PlatformAccessory {
  public fanService!: Service;
  public lightBulbService!: Service;
  public fooService!: Service;
  public lightSelectorService!: Service;
  public humiditySensorService!: Service;
  public temperatureSensorService!: Service;
  public whooshSwitchService!: Service;
  public dimToWarmSwitchService!: Service;
  public fanAutoSwitchService!: Service;
  public lightAutoSwitchService!: Service;
  public ecoModeSwitchService!: Service;

  public lightStates = {
    On: false,
    Brightness: 1,  // percent
    ColorTemperature: 2200,
    homeShieldUp: false,  // used to prevent Home.app from turning light on at 100% when it's at zero percent.
  };

  public fanStates = {
    On: false,
    RotationDirection: 1,
    RotationSpeed: 1,   // on scale from 1 to 7
    homeShieldUp: false,  // used to prevent Home.app from turning fan on at 100% when it's at zero percent.
    // fanAutoHackInProgress: false,
  };

  public showWhooshSwitch = false;
  public whooshSwitchOn = false;
  public fooOn = 0;
  public showDimToWarmSwitch = false;
  public dimToWarmSwitchOn = false;
  public showFanAutoSwitch = false;
  public fanAutoSwitchOn = false;
  public showLightAutoSwitch = false;
  public lightAutoSwitchOn = false;
  public showEcoModeSwitch = false;
  public ecoModeSwitchOn = false;
  public disableDirectionControl = false;

  public showTemperature = true;

  public IP: string;
  public MAC: string;
  public Name = 'naamloos';
  public ProbeFrequency = 60000;

  public probeTimeout;

  public modelUnknown = true;
  public firmwareUnknown = true;

  public Model = 'model not yet established';
  public SSID = 'apname';
  public Firmware = '';
  public OldProtocolFlag:boolean|undefined = undefined;

  public debugLevel = 1;
  public debugLevels:number[] = [];

  public CurrentTemperature = 0;
  public CurrentRelativeHumidity = 0;

  public client;
  public oneByteHeaders:number[] = [];

  mysteryProperties: string|number[] = [];  // to keep track of when they change - for hints to eventually figure out what they mean

  constructor(
    public readonly platform: BigAssFans_i6Platform,
    public readonly accessory: PlatformAccessory,
  ) {
    hbLog = platform.log;
    this.IP = accessory.context.device.ip;
    this.MAC = accessory.context.device.mac;
    this.Name = accessory.context.device.name;

    // defaults and enumeration of debugging keys
    this.debugLevels['light'] = 0; // 2;
    this.debugLevels['cluing'] = 0; // 6;
    this.debugLevels['network'] = 0;
    this.debugLevels['newcode'] = 0;
    this.debugLevels['humidity'] = 0;
    this.debugLevels['progress'] = 0;
    this.debugLevels['redflags'] = 0; // 1;
    this.debugLevels['direction'] = 0; // 1
    this.debugLevels['noopcodes'] = 0;
    this.debugLevels['characteristics'] = 0;

    if (this.accessory.context.device.debugLevels !== undefined) {
      for (const debugEntry of this.accessory.context.device.debugLevels) {
        const entry:(string | number)[] = debugEntry as (string | number)[];
        this.debugLevels[entry[0]] = entry[1];
      }
    }

    if (accessory.context.device.whoosh) {
      hbLog.warn('use of "whoosh" configuration attribute is deprecated, please use "showWhooshSwitch" instead');
      this.showWhooshSwitch = true;
    }
    if (accessory.context.device.showWhooshSwitch) {
      this.showWhooshSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.dimToWarm) {
      hbLog.warn(accessory.context.device.name +
          '- use of "dimToWarm" configuration attribute is deprecated, please use "showDimToWarmSwitch" instead');
      this.showDimToWarmSwitch = true;
    }
    if (accessory.context.device.showDimToWarmSwitch) {
      this.showDimToWarmSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.fanAuto) {
      hbLog.warn(accessory.context.device.name +
        '- use of "fanAuto" configuration attribute is deprecated, please use "showFanAutoSwitch" instead');
      this.showFanAutoSwitch = true;
    }
    if (accessory.context.device.showFanAutoSwitch) {
      this.showFanAutoSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.lightAuto) {
      hbLog.warn(accessory.context.device.name +
        '- use of "lightAuto" configuration attribute is deprecated, please use "showLightAutoSwitch" instead');
      this.showLightAutoSwitch = true;
    }
    if (accessory.context.device.showLightAutoSwitch) {
      this.showLightAutoSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.ecoMode) {
      hbLog.warn(accessory.context.device.name +
        '- use of "ecoMode" configuration attribute is deprecated, please use "showEcoModeSwitch" instead');
      this.showEcoModeSwitch = true;
    }
    if (accessory.context.device.showEcoModeSwitch) {
      this.showEcoModeSwitch = true;  // defaults to false in property initialization
    }

    if (accessory.context.device.probeFrequency !== undefined) {
      this.ProbeFrequency = accessory.context.device.probeFrequency;
      debugLog(this, 'progress',  1, 'set ProbeFrequency to: ' + this.ProbeFrequency);
    }

    if (accessory.context.device.disableDirectionControl) {
      this.disableDirectionControl = true;
    }

    /**
    * set accessory information
    */

    debugLog(this, 'newcode', 1, 'user supplied model: ' + this.accessory.context.device.fanModel);
    if (this.accessory.context.device.fanModel !== undefined && this.accessory.context.device.fanModel !== 'other') {
      this.Model = this.accessory.context.device.fanModel;
    }

    const capitalizeName = accessory.context.device.name[0] === accessory.context.device.name[0].toUpperCase();
    let accessoryName:string;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Big Ass Fans')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.MAC);

    // es6 up/downlight selector
    // this.lightSelectorService = this.accessory.getService(this.platform.Service.SecuritySystem) ||
    //   this.accessory.addService(this.platform.Service.SecuritySystem);
    // this.lightSelectorService.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
    //   .onGet(this.handleProgrammableSwitchEventGet.bind(this));
    // this.lightSelectorService.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
    //   .onGet(this.handleProgrammableSwitchOutputStateGet.bind(this))
    //   .onSet(this.handleProgrammableSwitchOutputStateSet.bind(this));

    // this.fooService = this.accessory.getService('foo') ||
    //   this.accessory.addService(this.platform.Service.Switch, 'foo', 'foo-1');
    // this.fooService.setCharacteristic(this.platform.Characteristic.Name, 'foo switch');

    // this.fooService.getCharacteristic(this.platform.Characteristic.On)
    //   .onSet(this.setFooOnState.bind(this))
    //   .onGet(this.getFooOnState.bind(this));


    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fan) ||
      this.accessory.addService(this.platform.Service.Fan);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    this.fanService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setFanOnState.bind(this))
      .onGet(this.getFanOnState.bind(this));

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    if (this.disableDirectionControl) {
      // for now am commenting out this 'removeCharacteristic' line because it doesn't remove the control anyway and if it did
      // I'd probably need to disable the update of the control in fanRotationDirection().  As it stands, fanRotationDirection()
      // lets us know if the direction changes via remote or BAF app.
      // this.fanService.removeCharacteristic(this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection));
    } else {
      this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection)
        .onSet(this.setRotationDirection.bind(this))
        .onGet(this.getRotationDirection.bind(this));
    }

    // Light Bulb
    this.lightBulbService = this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);
    accessoryName = capitalizeName ? ' Light' : ' light';
    this.lightBulbService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);

    this.lightBulbService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setLightOnState.bind(this))                // SET - bind to the `setLightOnState` method below
      .onGet(this.getLightOnState.bind(this));               // GET - bind to the `getOn` method below

    this.lightBulbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this))
      .onGet(this.getBrightness.bind(this));

    this.lightBulbService.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .onSet(this.setColorTemperature.bind(this))
      .onGet(this.getColorTemperature.bind(this));

    // Current Temperature
    debugLog(this, 'newcode', 1, 'this.accessory.context.device.showTemperature: ' + this.accessory.context.device.showTemperature);
    if (this.accessory.context.device.showTemperature === undefined || this.accessory.context.device.showTemperature !== false) {
      this.temperatureSensorService = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
        this.accessory.addService(this.platform.Service.TemperatureSensor);
      accessoryName = capitalizeName ?  ' Temperature' : ' temperature';
      this.temperatureSensorService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);
      this.temperatureSensorService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getCurrentTemperature.bind(this));
    } else {
      const service = this.accessory.getService(this.platform.Service.TemperatureSensor);
      if (service) {
        this.accessory.removeService(service);
      } else {
        debugLog(this, 'newcode', 1, 'service: ' + service);
      }
    }

    // Current Relative Humidity
    this.humiditySensorService = this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor);
    accessoryName = capitalizeName ?  ' Humidity' : ' humidity';
    this.humiditySensorService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);

    this.humiditySensorService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentRelativeHumidity.bind(this));

    // Switches
    if (this.showWhooshSwitch) {
      this.whooshSwitchService = this.accessory.getService('whooshSwitch') ||
        this.accessory.addService(this.platform.Service.Switch, 'whooshSwitch', 'switch-1');
      accessoryName = capitalizeName ?  ' Whoosh' : ' whoosh';
      this.whooshSwitchService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);

      this.whooshSwitchService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setWhooshSwitchOnState.bind(this))
        .onGet(this.getWhooshSwitchOnState.bind(this));
    } else {
      const service = this.accessory.getService('whooshSwitch');
      if (service) {
        this.accessory.removeService(service);
      }
    }
    if (this.showDimToWarmSwitch) {
      this.dimToWarmSwitchService = this.accessory.getService('dimToWarmSwitch') ||
        this.accessory.addService(this.platform.Service.Switch, 'dimToWarmSwitch', 'switch-2');
      accessoryName = capitalizeName ?  ' Dim to Warm' : ' dim to warm';
      this.dimToWarmSwitchService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);

      this.dimToWarmSwitchService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setDimToWarmSwitchOnState.bind(this))
        .onGet(this.getDimToWarmSwitchOnState.bind(this));
    } else {
      const service = this.accessory.getService('dimToWarmSwitch');
      if (service) {
        this.accessory.removeService(service);
      }
    }
    if (this.showFanAutoSwitch) {
      this.fanAutoSwitchService = this.accessory.getService('fanAutoSwitch') ||
        this.accessory.addService(this.platform.Service.Switch, 'fanAutoSwitch', 'switch-3');
      accessoryName = capitalizeName ?  ' Fan Auto' : ' fan auto';
      this.fanAutoSwitchService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);

      this.fanAutoSwitchService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setFanAutoSwitchOnState.bind(this))
        .onGet(this.getFanAutoSwitchOnState.bind(this));
    } else {
      const service = this.accessory.getService('fanAutoSwitch');
      if (service) {
        this.accessory.removeService(service);
      }
    }
    if (this.showLightAutoSwitch) {
      this.lightAutoSwitchService = this.accessory.getService('lightAutoSwitch') ||
        this.accessory.addService(this.platform.Service.Switch, 'lightAutoSwitch', 'switch-4');
      accessoryName = capitalizeName ?  ' Light Auto' : ' light auto';
      this.lightAutoSwitchService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);

      this.lightAutoSwitchService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setLightAutoSwitchOnState.bind(this))
        .onGet(this.getLightAutoSwitchOnState.bind(this));
    } else {
      const service = this.accessory.getService('lightAutoSwitch');
      if (service) {
        debugLog(this, 'light', 1, 'removeService: lightAutoSwitch');
        this.accessory.removeService(service);
      }
    }
    if (this.showEcoModeSwitch) {
      this.ecoModeSwitchService = this.accessory.getService('ecoModeSwitch') ||
        this.accessory.addService(this.platform.Service.Switch, 'ecoModeSwitch', 'switch-5');
      accessoryName = capitalizeName ?  ' Eco Mode' : ' eco mode';
      this.ecoModeSwitchService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);

      this.ecoModeSwitchService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setEcoModeSwitchOnState.bind(this))
        .onGet(this.getEcoModeSwitchOnState.bind(this));
    } else {
      const service = this.accessory.getService('ecoModeSwitch');
      if (service) {
        this.accessory.removeService(service);
      }
    }

    /**
    * open the fan's communication port, establish the data and error callbacks, send the initialization sequence and send a probe
    */
    networkSetup(this);
    debugLog(this, 'progress', 2, 'constructed');
  }

  /**
  * 'SET' request is issued when HomeKit wants us to change the state of an accessory.
  * 'GET' request is issued  when HomeKit wants to know the state of an accessory.
  */
  //  async setFooOnState(value: CharacteristicValue) {
  //   hbLog.debug('Set Characteristic foo Switch On -> ' + value);
  //   if (this.fooOn == 0) {
  //     hbLog.debug('down')
  //     this.fooOn = 1; // down
  //     this.fooService.setCharacteristic(this.platform.Characteristic.Name, 'downlight');
  //   } else if (this.fooOn == 1) {
  //     hbLog.debug('up')
  //     this.fooOn = 2; // up
  //     this.fooService.setCharacteristic(this.platform.Characteristic.Name, 'uplight');
  //   } else if (this.fooOn == 2) {
  //     hbLog.debug('both')
  //     this.fooOn = 0; // both
  //     this.fooService.setCharacteristic(this.platform.Characteristic.Name, 'both');
  //   }
  // }
  // async getFooOnState(): Promise<CharacteristicValue> {
  //   // hbLog.debug('Get Characteristic foo Switch On -> ' + this.fooOn);
  //   return 1;
  // }
  // async handleProgrammableSwitchEventGet() {
  //   hbLog.debug('Triggered GET ProgrammableSwitchEvent');


  //   return this.fooOn;
  // }
  // async handleProgrammableSwitchOutputStateGet() {
  //   hbLog.debug('Triggered GET ProgrammableSwitchOutputState');

  //   return this.fooOn;
  // }
  // async handleProgrammableSwitchOutputStateSet(value) {
  //   hbLog.debug('Triggered SET ProgrammableSwitchOutputState:' + value);
  //   if (value == 0) {
  //     hbLog.debug('both')
  //   } else if (value == 1) {
  //     hbLog.debug('down')
  //   } else if (value == 2) {
  //     hbLog.debug('up')
  //   }
  //   this.fooOn = value;
  // }

  async setLightOnState(value: CharacteristicValue) {
    debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Light On -> ' + value);

    if (this.lightStates.On && (value as boolean)) {
      debugLog(this, 'light', 1, 'setLightOnState: redundant, ignore this');
    } else {
      this.lightStates.On = value as boolean;
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, (this.lightStates.On ? 0x01 : 0x00), 0xc0])), this);
    }
  }

  async getLightOnState(): Promise<CharacteristicValue> {
    const isOn = this.lightStates.On;
    debugLog(this, ['light', 'characteristics'], [2, 4], 'Get Characteristic Light On -> ' + isOn);
    // if you need to return an error to show the device as 'Not Responding' in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return isOn;
  }

  async setBrightness(value: CharacteristicValue) {
    let b: Buffer;
    if (value === 0) {
      debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Brightness -> ' + value);
      this.lightStates.homeShieldUp = true;
      this.lightStates.Brightness = 0;
      const b1 = ONEBYTEHEADER.concat([0xa8, 0x04, 1, 0xc0]); // this one is for the device's memory
      const b2 = ONEBYTEHEADER.concat([0xa8, 0x04, 0, 0xc0]); // this one is actually turn off light
      b = Buffer.from(b1.concat(b2));
    } else if (value === 100 && this.lightStates.homeShieldUp) {
      this.lightStates.homeShieldUp = false;
      this.lightStates.Brightness = 1;
      b = Buffer.from(ONEBYTEHEADER.concat([0xa8, 0x04, 1, 0xc0]));
    } else {
      this.lightStates.homeShieldUp = false;
      debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Brightness -> ' + value);
      this.lightStates.Brightness = value as number;
      b = Buffer.from(ONEBYTEHEADER.concat([0xa8, 0x04, this.lightStates.Brightness, 0xc0]));
    }
    clientWrite(this.client, b, this);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const brightness = (this.lightStates.Brightness === 0 ? 1 : this.lightStates.Brightness);
    debugLog(this, ['light', 'characteristics'], [2, 4], 'Get Characteristic Brightness -> ' + brightness);
    return brightness;
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    const temperature = this.CurrentTemperature;
    debugLog(this, 'characteristics', 4, 'Get Characteristic CurrentTemperature -> ' + temperature);
    return temperature;
  }

  async getCurrentRelativeHumidity(): Promise<CharacteristicValue> {
    const humidity = this.CurrentRelativeHumidity;
    debugLog(this, 'characteristics', 4, 'Get Characteristic CurrentRelativeHumidity -> ' + humidity);
    return humidity;
  }

  async setFanOnState(value: CharacteristicValue) {
    debugLog(this, 'characteristics', 3, 'Set Characteristic Fan On -> ' + value);
    this.fanStates.On = value as boolean;

    // If the fan is in Auto mode and on command in response to this Set from HomeKit,
    // then it's going to reply with FanOn 0x01 which will cause us to drop it out of auto because it's not 0x02.
    // If homekit is telling us to setFanOnState On while it's in Auto Mode, it must be because we changed the speed so,
    // ignore this setFanOnState request.
    if (this.fanAutoSwitchOn && this.fanStates.On) {
      return;
    }
    clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xd8, 0x02, (this.fanStates.On ? 0x01 : 0x00), 0xc0])), this);
  }

  async getFanOnState(): Promise<CharacteristicValue> {
    const isOn = this.fanStates.On;
    debugLog(this, 'characteristics', 3, 'Get Characteristic Fan On -> ' + isOn);
    return isOn;
  }

  async setRotationSpeed(value: CharacteristicValue) {
    let b: Buffer;
    if (value === 0) {
      debugLog(this, 'characteristics', 3, 'Set Characteristic RotationSpeed -> ' + (value as number) + '%');
      this.fanStates.homeShieldUp = true;
      this.fanStates.RotationSpeed = 0;
      const b1 = ONEBYTEHEADER.concat([0xf0, 0x02, 1, 0xc0]); // this one is for the device's memory
      const b2 = ONEBYTEHEADER.concat([0xf0, 0x02, 0, 0xc0]); // this one will actually stop rotation
      b = Buffer.from(b1.concat(b2));
    } else if (value === 100 && this.fanStates.homeShieldUp) {
      this.fanStates.homeShieldUp = false;
      this.fanStates.RotationSpeed = 1;
      b = Buffer.from(ONEBYTEHEADER.concat([0xf0, 0x02, 1, 0xc0]));
    } else {
      this.fanStates.homeShieldUp = false;
      debugLog(this, 'characteristics', 3, 'Set Characteristic RotationSpeed -> ' + (value as number) + '%');
      this.fanStates.RotationSpeed = Math.round(((value as number) / 100) * MAXFANSPEED);
      if (this.fanStates.RotationSpeed > MAXFANSPEED) {
        hbLog.warn(this.Name + ' - fan speed > ' + MAXFANSPEED + ': ' + this.fanStates.RotationSpeed + ', setting to ' + MAXFANSPEED);
        this.fanStates.RotationSpeed = MAXFANSPEED;
      }
      b = Buffer.from(ONEBYTEHEADER.concat([0xf0, 0x02, this.fanStates.RotationSpeed, 0xc0]));
    }
    clientWrite(this.client, b, this);
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {  // get speed as percentage
    let rotationPercent = Math.round((this.fanStates.RotationSpeed / MAXFANSPEED) * 100);
    if (rotationPercent === 0) {
      rotationPercent = 1;
    }
    debugLog(this, 'characteristics', 4, 'Get Characteristic RotationSpeed -> ' + rotationPercent + '%');
    return rotationPercent;
  }

  async setRotationDirection(value: CharacteristicValue) {
    debugLog(this, 'characteristics', 3, 'Set Characteristic RotationDirection -> ' + value);
    this.fanStates.RotationDirection = ((value as number) === 0 ? 1 : 0);

    // 0 is clockwise, 1 is counterclockwise
    clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xe0, 0x02, this.fanStates.RotationDirection, 0xc0])), this);
  }

  async getRotationDirection(): Promise<CharacteristicValue> {
    const rotationDirection = this.fanStates.RotationDirection;
    debugLog(this, 'characteristics', 3, 'Get Characteristic RotationDirection -> ' + rotationDirection);
    return rotationDirection;
  }

  // Mireds!
  async setColorTemperature(value: CharacteristicValue) {
    // should maybe limit color temp to one of 5 BAF supported values - 2200, 2700, 4000, 5000, 6500?
    this.lightStates.ColorTemperature = Math.round(1000000/(value as number));
    debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic ColorTemperature  -> ' + value +
        ' (' + this.lightStates.ColorTemperature + ')');
    const stuffedVarInt = stuff(varint_encode(this.lightStates.ColorTemperature));
    const firstPart = [0xc0, 0x12, stuffedVarInt.length + 6, 0x12, stuffedVarInt.length + 4, 0x1a, stuffedVarInt.length + 2, 0xb8, 0x04];
    clientWrite(this.client, Buffer.from(firstPart.concat(stuffedVarInt, 0xc0)), this);
  }

  async getColorTemperature(): Promise<CharacteristicValue> {
    const colorTemperature = Math.round(1000000 / this.lightStates.ColorTemperature);
    debugLog(this, ['light', 'characteristics'], [1, 4], 'Get Characteristic ColorTemperature -> ' + colorTemperature +
        ' (' + this.lightStates.ColorTemperature + ')');
    return colorTemperature;
  }

  // set/get won't get called unless showWhooshSwitch is true
  async setWhooshSwitchOnState(value: CharacteristicValue) {
    debugLog(this, 'characteristics', 3, 'Set Characteristic Whoosh Switch On -> ' + value);
    this.whooshSwitchOn = value as boolean;
    clientWrite(this.client,
      Buffer.from(ONEBYTEHEADER.concat([0xd0, 0x03, (this.whooshSwitchOn ? 0x01 : 0x00), 0xc0])), this);
  }

  async getWhooshSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.whooshSwitchOn;
    debugLog(this, 'characteristics', 4, 'Get Characteristic Whoosh Switch On -> ' + isOn);
    return isOn;
  }

  // set/get won't get called unless showDimToWarmSwitch is true
  async setDimToWarmSwitchOnState(value: CharacteristicValue) {
    debugLog(this, 'characteristics', 3, 'Set Characteristic Dim to Warm Switch On -> ' + value);
    this.dimToWarmSwitchOn = value as boolean;
    clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xe8, 0x04, (this.dimToWarmSwitchOn ? 0x01 : 0x00), 0xc0])), this);
  }

  async getDimToWarmSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.dimToWarmSwitchOn;
    debugLog(this, 'characteristics', 4, 'Get Characteristic Dim to Warm Switch On -> ' + isOn);
    return isOn;
  }

  // set/get won't get called unless showFanAutoSwitch is true
  async setFanAutoSwitchOnState(value: CharacteristicValue) {
    debugLog(this, 'characteristics', 3, 'Set Characteristic Fan Auto Switch On -> ' + value);
    this.fanAutoSwitchOn = value as boolean;
    if (this.fanAutoSwitchOn) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xd8, 0x02, 0x02, 0xc0])), this);
    } else {
      // in order for fan to turn auto off, we need to tell it to be on or off
      this.setFanOnState(this.fanStates.On);
    }
  }

  async getFanAutoSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.fanAutoSwitchOn;
    debugLog(this, 'characteristics', 3, 'Get Characteristic Fan Auto Switch On -> ' + isOn);
    return isOn;
  }

  // set/get won't get called unless showLightAutoSwitch is true
  async setLightAutoSwitchOnState(value: CharacteristicValue) {
    debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Light Auto Switch On -> ' + value);
    this.lightAutoSwitchOn = value as boolean;

    if (this.lightAutoSwitchOn) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, 0x02, 0xc0])), this);
    } else {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, (this.lightStates.On ? 0x01 : 0x00), 0xc0])), this);
    }
    // if (this.lightAutoSwitchOn === false && this.lightStates.On === false) {
    //   debugLog(this, 'newcode', 1, 'call setLightOnState(0) from setLightAutoSwitchOnState');
    //   this.setLightOnState(0);  // lights already off, this should turn off Auto as far as BAF/device are concerned
    // }
    // if (this.lightAutoSwitchOn === true && this.lightStates.On === false) {
    //   debugLog(this, 'newcode', 1, 'write ..., 0xa0, 0x04, 0x02, 0xc0 to fan');
    //   clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, 0x02, 0xc0])), this);
    // }


    // if (this.lightAutoSwitchOn === true && this.lightStates.On === true) {
    //   debugLog(this, 'newcode', 1, 'write ..., 0xa0, 0x04, 0x02, 0xc0 to fan');
    //   clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, 0x02, 0xc0])), this);
    // }

    // if (this.lightAutoSwitchOn === false && this.lightStates.On === true) {
    //   debugLog(this, 'newcode', 1, 'write ..., 0xa0, 0x04, 0x01, 0xc0 to fan');
    //   clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, 0x01, 0xc0])), this);
    // }

  }

  async getLightAutoSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.lightAutoSwitchOn;
    debugLog(this, 'characteristics', 3, 'Get Characteristic Light Auto Switch On -> ' + isOn);
    return isOn;
  }

  // set/get won't get called unless showEcoModeSwitch is true
  async setEcoModeSwitchOnState(value: CharacteristicValue) {
    debugLog(this, 'characteristics', 3, 'Set Characteristic Eco Mode Switch On -> ' + value);
    this.ecoModeSwitchOn = value as boolean;
    clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x88, 0x04, (this.ecoModeSwitchOn ? 0x01 : 0x0), 0xc0])), this);
  }

  async getEcoModeSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.ecoModeSwitchOn;
    debugLog(this, 'characteristics', 3, 'Get Characteristic Eco Mode Switch On -> ' + isOn);
    return isOn;
  }
}

/**
* connect to the fan, send an initialization message, establish the error and data callbacks and start a keep-alive interval timer.
*/
import net = require('net');

function networkSetup(pA: BigAssFans_i6PlatformAccessory) {

  if (pA.ProbeFrequency !== 0) {
    // attempt to prevent the occassional socket reset.
    // sending the mysterious code that the vendor app seems to send once every 15s but I'll go with every minute -  didn't prevent it.
    // can try going to every 15 seconds like the vendor app seems to do. - didn't work
    // perhaps I need to call socket.setKeepAlive([enable][, initialDelay]) when I establish it above? - nope, didn't help
    // obviously, I don't understand this stuff.
    // now I got an EPIPE 5+ hours after a reset, and repeaated EPIPEs evert minute for the next 7 minutes, then one more after 4 minutes
    // then clear sailing for 1+ hours so far.
    pA.probeTimeout = setInterval(( )=> {
      // debugLog(pA, 'newcode', 1, "probing...");
      if (pA.client !== undefined) {
        clientWrite(pA.client, Buffer.from([0xc0, 0x12, 0x04, 0x1a, 0x02, 0x08, 0x03, 0xc0]), pA);
      } else {
        debugLog(pA, 'network', 4, 'client undefined in setInterval callback');
      }
    }, pA.ProbeFrequency);
  }

  pA.client = net.connect(31415, pA.IP, () => {
    debugLog(pA, 'progress', 2, 'connected!');
    pA.client.setKeepAlive(true);

    clientWrite(pA.client, Buffer.from([0xc0, 0x12, 0x02, 0x1a, 0x00, 0xc0]), pA);
  });

  let errHandler;

  pA.client.on('error', errHandler = (err) => {
    let retryMillisconds = 2000;
    if (err.code === 'ECONNRESET') {
      hbLog.warn(pA.Name + ' (' + pA.IP + ')' + ' network connection reset [ECONNRESET].  Attempting reconnect in 2 seconds.');
    } else if (err.code === 'EPIPE') {
      hbLog.warn(pA.Name + ' (' + pA.IP + ')' + ' network connection broke [EPIPE].  Attempting reconnect in 2 seconds.');
    } else if (err.code === 'ETIMEDOUT') {
      hbLog.error(pA.Name + ' (' + pA.IP + ')' + ' connection timed out [ETIMEDOUT].  '  +
        'Check that your fan has power and the correct IP is in json.config.');
      return;
    } else if (err.code === 'ECONNREFUSED') {
      hbLog.error(pA.Name + ' (' + pA.IP + ')' + ' connection refused [ECONNREFUSED].  Check that the correct IP is in json.config.');
      if (pA.probeTimeout !== undefined) {
        debugLog(pA, 'newcode', 1, 'clearInterval timer');
        clearInterval(pA.probeTimeout);
      }
      return;
    } else if (err.code === 'ENETUNREACH') {
      hbLog.error(pA.Name + ' (' + pA.IP + ')' + ' is unreachable [ENETUNREACH].  Check the correct IP is in json.config.');
      return;
    } else if (err.code === 'EHOSTDOWN') {
      hbLog.error(pA.Name + ' (' + pA.IP + ')' + ' connection problem [EHOSTDOWN].  Attempting reconnect in one minute.');
      retryMillisconds = 60000;
    } else {
      hbLog.warn(pA.Name + ' (' + pA.IP + ')' + ': Unhandled network error: ' + err.code + '.  Attempting reconnect in 2 seconds.');
    }
    pA.client = undefined;
    setTimeout(() => {
      // already did this one or more times, don't need to send initilization message
      pA.client = net.connect(31415, pA.IP, () => {
        hbLog.info(pA.Name + ' reconnected!');
      });
      pA.client.on('error', (err) => {
        errHandler(err);
      });
      pA.client.on('data', (data) => {
        onData(pA, data);
      });
    }, retryMillisconds);
  });

  /**
  *  separate the data into chunks as required and feed them to parseFanMessage() one at a time.
  */
  pA.client.on('data', (data: Buffer) => {
    const oldFlag = pA.OldProtocolFlag;

    if (pA.OldProtocolFlag === undefined ||
        (pA.OldProtocolFlag === false && pA.Model === MODEL_i6)) { // try, try, if you don't succeed
      pA.OldProtocolFlag = ((data.length >= 73) && (data[data.length - 73] === 0x28));
      const msgString = 'assuming ' + (pA.OldProtocolFlag ? 'old' : 'new') + ' protocol';
      debugLog(pA, 'network', 1, msgString);

      if (oldFlag === false && pA.OldProtocolFlag === true) {
        debugLog(pA, 'redflags', 1, 'succeeded: OldProtocolFlag flipped to true');
      }
    }
    onData(pA, data);
  });

}

function onData(pA: BigAssFans_i6PlatformAccessory, data: Buffer) {
  debugLog(pA, 'network', 13, 'raw (stuffed) data: ' + hexFormat(data));
  debugLog(pA, 'network', 8, 'accessory client got: ' + data.length + (data.length === 1 ? ' byte' : ' bytes'));

  // break data into individual chunks bracketed by 0xc0
  let startIndex = -1;
  let endIndex = -1;
  let numChunks = 0;
  const chunks: Buffer[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0xc0) {
      if (startIndex < 0) {
        startIndex = i;
        endIndex = -1;
      } else {
        endIndex = i;
        chunks[numChunks] = data.subarray(startIndex, endIndex+1);
        numChunks++;
        startIndex = -1;
      }
    }
  }

  for (let i = 0; i < numChunks; i++) {
    if (chunks[i][0] !== 0xc0 || chunks[i][chunks[i].length-1] !== 0xc0) {
      debugLog(pA, 'redflags', 1, 'unbracketed chunk');
      return;
    } else {
      chunks[i] = chunks[i].subarray(1, chunks[i].length-1);
    }

    debugLog(pA, 'network', 11, 'raw (unstuffed) chunks[' + i + ']: ' + hexFormat(unstuff(chunks[i])));
    doChunk(unstuff(chunks[i]), pA);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sortFunction(a, b) {
  if (a[0] === b[0]) {
    return 0;
  } else {
    return (a[0] < b[0]) ? -1 : 1;
  }
}

/**
* property handler functions
*/

function bulbPresent(value: boolean, pA:BigAssFans_i6PlatformAccessory) {
  if (value) {
    debugLog(pA, 'light', 1, 'light detected');
    infoLogOnce(pA, 'light detected');
  } else {
    infoLogOnce(pA, 'no light detected');
    debugLog(pA, 'light', 1, 'no light detected');
    const service = pA.accessory.getService(pA.platform.Service.Lightbulb);
    if (service) {
      debugLog(pA, 'light', 1, 'remove service: Lightbulb');
      pA.accessory.removeService(service);
    }
  }
}

function productType(value: string, pA:BigAssFans_i6PlatformAccessory) {
  const regex = /[ -~]/g;  // count the printable characters
  const found = value.match(regex);
  if (found === null || (found.length !== value.length)) {
    debugLogOnce(pA, 'redflags', 1, 'Unexpected characters in model name: ' + hexFormat(Buffer.from(value, 'utf8')));
    return;
  }

  if (pA.modelUnknown) {  // need to do this only once
    pA.modelUnknown = false;

    if (pA.accessory.context.device.devModelOverride) {
      debugLog(pA, 'progress', 0, 'overriding product type "' + value + '" with "' + pA.accessory.context.device.devModelOverride + '"');
      value = pA.accessory.context.device.devModelOverride;
    }
    pA.Model = value;
    debugLog(pA, 'progress', 0, 'product type: ' + pA.Model + ' (' + hexFormat(Buffer.from(value, 'utf8')) + ')');

    pA.accessory.getService(pA.platform.Service.AccessoryInformation)!
      .setCharacteristic(pA.platform.Characteristic.Model, pA.Model);

    if (pA.Model === MODEL_HAIKU_HI || pA.Model === MODEL_HAIKU_L) {
      // this.lightBulbService.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      //   .removeAllListeners('set')
      //   .removeAllListeners('get');
      debugLog(pA, 'newcode', 1, 'no ColorTemperature Characteristic for product type "' + pA.Model + '"');
      pA.lightBulbService.removeCharacteristic(pA.lightBulbService.getCharacteristic(pA.platform.Characteristic.ColorTemperature));
    }

    if (pA.Model === MODEL_HAIKU_HI || pA.Model === MODEL_HAIKU_L) {
      const service = pA.accessory.getService(pA.platform.Service.HumiditySensor);
      if (service) {
        pA.accessory.removeService(service);
        debugLog(pA, 'newcode', 1, 'no HumiditySensor service for product type "' + pA.Model + '"');
      }
    }

    if (pA.Model === MODEL_HAIKU_L) {
      const service = pA.accessory.getService(pA.platform.Service.TemperatureSensor);
      if (service) {
        pA.accessory.removeService(service);
        debugLog(pA, 'newcode', 1, 'no TemperatureSensor service for product type "' + pA.Model + '"');
      } else {
        debugLog(pA, 'newcode', 1, 'service: ' + service);
      }
    }
  }
}

function firmwareVersion(value: string, pA: BigAssFans_i6PlatformAccessory) {
  if (pA.firmwareUnknown) {  // need to do this only once
    pA.firmwareUnknown = false;

    pA.Firmware = value;
    if (value.length !== 0) {
      pA.accessory.getService(pA.platform.Service.AccessoryInformation)!
        .setCharacteristic(pA.platform.Characteristic.FirmwareRevision, pA.Firmware);
    } else {
      pA.Firmware = 'nil';
    }
    debugLog(pA, 'progress', 0, 'firmware: ' + pA.Firmware);
  }
}

function lightColorTemperature(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (!pA.accessory.getService(pA.platform.Service.Lightbulb)) {
    debugLog(pA, 'newcode', 1, 'lightColorTemperature: no lightbulb Service');
    return;
  }
  if (pA.Model !== MODEL_HAIKU_HI && pA.Model !== MODEL_HAIKU_L) {
    pA.lightStates.ColorTemperature = value;
    const mireds = Math.round(1000000 / pA.lightStates.ColorTemperature);
    debugLog(pA, ['light', 'characteristics'], [1, 3], 'update ColorTemperature: ' + mireds + ' (' + pA.lightStates.ColorTemperature + ')');
    pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.ColorTemperature, mireds);
  } else {
    // debugLog(pA, 'newcode', 1, 'ColorTemperature: ignored');
  }
}

function lightBrightness(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (!pA.accessory.getService(pA.platform.Service.Lightbulb)) {
    debugLog(pA, 'newcode', 1, 'lightBrightness: no lightbulb Service');
    return;
  }

  if (value !== 0) {
    pA.lightStates.homeShieldUp = false;
    pA.lightStates.Brightness = (value as number);
    debugLog(pA, ['light', 'characteristics'], [1, 3], 'update Brightness: ' + pA.lightStates.Brightness);
    pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.Brightness, pA.lightStates.Brightness);
    if (pA.lightStates.On === false) {
      pA.lightStates.On = true;
      debugLog(pA, ['light', 'characteristics'], [1, 3], 'update Light On From lightBrightness: ' + pA.lightStates.On);
      pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightStates.On);
    }
  } else {
    if (pA.lightStates.On === true) {
      pA.lightStates.On = false;
      debugLog(pA, ['light', 'characteristics'], [1, 3], 'update Light On From lightBrightness: ' + pA.lightStates.On);
      pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightStates.On);
    }
  }
}

function lightOnState(value: number, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'light', 1, 'lightOnState value: ' + value);

  if (!pA.accessory.getService(pA.platform.Service.Lightbulb)) {
    debugLog(pA, 'newcode', 1, 'lightOnState: no lightbulb Service');
    return;
  }

  if (value === 0 || value === 1) {
    const onValue = (value === 0 ? false : true);
    if (onValue !== pA.lightStates.On) {
      pA.lightStates.On = onValue;
      debugLog(pA, ['light', 'characteristics'], [1, 3], 'update Light On: ' + pA.lightStates.On);
      pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightStates.On);
    }

    if (pA.lightAutoSwitchOn) {
      pA.lightAutoSwitchOn = false;
      debugLog(pA, ['light', 'characteristics'], [1, 3], 'update light auto switch off: ' + pA.lightAutoSwitchOn);
      pA.lightAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightAutoSwitchOn);
    }
  } else if (pA.showLightAutoSwitch && value === 2 && pA.lightAutoSwitchOn === false) {
    pA.lightAutoSwitchOn = true;
    debugLog(pA, ['light', 'characteristics'], [1, 3], 'update light auto switch on: ' + pA.lightAutoSwitchOn);
    pA.lightAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightAutoSwitchOn);
  }
}

function fanOnState(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showFanAutoSwitch) {
    pA.fanAutoSwitchOn = (value === 2) ? true: false;
    debugLog(pA, 'characteristics', 3, 'update fan auto: ' + pA.fanAutoSwitchOn);
    pA.fanAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanAutoSwitchOn);
  }

  if (value !== 2) {
    const onValue = (value === 0 ? false : true);
    pA.fanStates.On = onValue;
    debugLog(pA, 'characteristics', 3, 'update FanOn: ' + pA.fanStates.On);
    pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
  }
}

function fanRotationDirection(value: number, pA:BigAssFans_i6PlatformAccessory) {
  //  fan reports if 'reverse rotation' is on or off, homebridge wants rotation direction
  //  reverse switch off (0) == rotation direction counterclockwise (1)
  const rotationDirection = value === 0 ? 1 : 0;
  pA.fanStates.RotationDirection = rotationDirection;
  debugLog(pA, ['direction', 'characteristics'], [1, 3], 'update RotationDirection: ' + pA.fanStates.RotationDirection);
  pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationDirection, pA.fanStates.RotationDirection);
}

function fanRotationSpeed(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (value !== 0) { // don't tell homebridge speed is zero, it only confuses it.  It'll find out it's off in due course.
    pA.fanStates.homeShieldUp = false;
    pA.fanStates.RotationSpeed = (value as number);
    debugLog(pA, 'characteristics', 3, 'set speed to ' + pA.fanStates.RotationSpeed);
    // convert to percentage for homekit
    const speedPercent = Math.round((pA.fanStates.RotationSpeed / MAXFANSPEED) * 100);
    debugLog(pA, 'characteristics', 3, 'update RotationSpeed: ' + speedPercent + '%');
    pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationSpeed, speedPercent);

    if (!pA.fanStates.On) {
      pA.fanStates.On = true;
      debugLog(pA, 'characteristics', 3, 'update FanOn: ' + pA.fanStates.On + ' because (auto && speed > 0)');
      pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
    }
  } else {
    if (pA.fanStates.On) {
      pA.fanStates.On = false;
      debugLog(pA, 'characteristics', 3, 'update FanOn: ' + pA.fanStates.On + ' because (auto && speed == 0)');
      pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
    }
  }
}

function currentTemperature(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (!pA.accessory.getService(pA.platform.Service.TemperatureSensor)) {
    debugLog(pA, 'newcode', 1, 'currentTemperature: no TemperatureSensor Service');
    return;
  }
  if (pA.accessory.context.device.showTemperature !== undefined && pA.accessory.context.device.showTemperature === false) {
    debugLog(pA, 'newcode', 1, 'ignoring temperature');
    return;
  }

  if (value < -270 || value > 100) {
    // Haiku L doesn't seem to support the temperature sensor, it just reports 1000º.  ignore it
    if (value === 1000) {
      infoLogOnce(pA, 'current temperature out of range: ' + value + ', assuming no temperature sensor for model "' + pA.Model + '"');
    } else {
      hbLog.info(pA.Name + ' - current temperature out of range: ' + value + ', ignored');
    }
    return;
  }

  pA.CurrentTemperature = Number(value);
  debugLog(pA, 'characteristics', 3, 'update CurrentTemperature:' + pA.CurrentTemperature);
  pA.temperatureSensorService.updateCharacteristic(pA.platform.Characteristic.CurrentTemperature, pA.CurrentTemperature);
}

function currentRelativeHumidity(value: number, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'humidity', 2, pA.Name + ' - CurrentRelativeHumidity:' + value);

  if (!pA.accessory.getService(pA.platform.Service.HumiditySensor)) {
    debugLog(pA, 'newcode', 1, 'currentRelativeHumidity: no HumiditySensor Service');
    return;
  }


  if (value < 0 || value > 100) {
    // Haikus don't seem to support the humidity sensor, they just report 1000%.  ignore it
    // should replace this function with noop in property table
    if (value === 1000) {
      infoLogOnce(pA, 'current relative humidity out of range: ' + value + ', assuming no humidity sensor for model "' + pA.Model + '"');
      return;
    } else {
      hbLog.info(pA.Name + ' - current relative humidity out of range: ' + value + ', ignored');
    }
    return;
  }

  pA.CurrentRelativeHumidity = Number(value);
  debugLog(pA, 'characteristics', 3, 'update CurrentRelativeHumidity:' + pA.CurrentRelativeHumidity);
  pA.humiditySensorService.updateCharacteristic(pA.platform.Characteristic.CurrentRelativeHumidity, pA.CurrentRelativeHumidity);
}

function whooshOnState(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showWhooshSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.whooshSwitchOn = onValue;
    debugLog(pA, 'characteristics', 3, 'update Whoosh:' + pA.whooshSwitchOn);
    pA.whooshSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.whooshSwitchOn);
  }
}

function dimToWarmOnState(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showDimToWarmSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.dimToWarmSwitchOn = onValue;
    debugLog(pA, 'characteristics', 3, 'update Dim to Warm:' + pA.dimToWarmSwitchOn);
    pA.dimToWarmSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.dimToWarmSwitchOn);
  }
}

function ecoModeOnState(value: number, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showEcoModeSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.ecoModeSwitchOn = onValue;
    debugLog(pA, 'characteristics', 3, 'update Eco Mode:' + pA.ecoModeSwitchOn);
    pA.ecoModeSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.ecoModeSwitchOn);
  }
}

// function lightSelector(value: number, pA: BigAssFans_i6PlatformAccessory) {
//   switch (value) {
//     case 0:
//       pA.fooOn == 0;
//       pA.lightSelectorService.setCharacteristic(pA.platform.Characteristic.SecuritySystemCurrentState, 0);
//       break;
//     case 1:
//       pA.fooOn == 1;
//       pA.lightSelectorService.setCharacteristic(pA.platform.Characteristic.SecuritySystemCurrentState, 1);
//       break;
//     case 2:
//       pA.fooOn == 2;
//       pA.lightSelectorService.setCharacteristic(pA.platform.Characteristic.SecuritySystemCurrentState, 2);
//      break
//     default:
//       debugLog(pA, 'redflags', 0, 'unknown light selector value' + value);
//       pA.lightSelectorService.setCharacteristic(pA.platform.Characteristic.SecuritySystemCurrentState, 3);
//       break;
//   }
// }

// keeping track to gather clues in unending effort to ID unknown codes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mysteryCode(value: string, pA:BigAssFans_i6PlatformAccessory, code: string) {
  const v = value;
  const p = pA.mysteryProperties[code];

  if (p !== undefined) {
    if (p !== v) {
      debugLog(pA, 'cluing', 3, 'mystery property value: ' + code + ' changed from: ' + p + ', to: ' + v);
      pA.mysteryProperties[code] = v;
    }
  } else {
    debugLog(pA, 'cluing', 4, 'initial mystery property value: ' + code + ', : ' + v);
    pA.mysteryProperties[code] = v;
  }
}

// a little hack for codes under investigation
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function codeWatch(s: string, v: string|number|Buffer, m: Buffer, pA:BigAssFans_i6PlatformAccessory) {
  if (s === '0xe8, 0x01') {
    debugLog(pA, 'cluing', 5, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } if (s === '0xd8, 0x01') {
    debugLog(pA, 'cluing', 5, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } else if (s === '0x18, 0xc0') {
    debugLog(pA, 'cluing', 5, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } else if (s === '0xda, 0x0a') {
    debugLog(pA, 'cluing', 5, 'code watch - s: ' + s + ', v: ' + hexFormat(v));
  }
}

const ESC = 0xDB;
const START = 0xc0;
const ESC_STUFF = 0xDD;
const START_STUFF = 0xDC;

// 0xdb, 0xdc -> 0xc0
// 0xdb, 0xdd -> 0xdb

function unstuff(data: Buffer): Buffer {
  const unstuffedData: number[] = [];
  let dataIndex = 0;
  let unstuffedDataIndex = 0;
  while (dataIndex < data.length) {
    if (data[dataIndex] === ESC && data[dataIndex+1] === START_STUFF) {
      unstuffedData[unstuffedDataIndex++] = START;
      dataIndex += 2; // skip over the ESC and the START_STUFF
    } else if (data[dataIndex] === ESC && data[dataIndex+1] === ESC_STUFF) {
      unstuffedData[unstuffedDataIndex++] = ESC;
      dataIndex += 2; // skip over the ESC and the ESC_STUFF
    } else {
      unstuffedData[unstuffedDataIndex++] = data[dataIndex++];
    }
  }
  return Buffer.from(unstuffedData);
}

function stuff(inArray: number[]) : number[] {
  const outArray:number[] = [];
  let outIndex = 0;
  for (let i = 0; i < inArray.length; i++) {
    if (inArray[i] === START) {
      outArray[outIndex++] = ESC;
      outArray[outIndex++] = START_STUFF;
    } else if (inArray[i] === ESC) {
      outArray[outIndex++] = ESC;
      outArray[outIndex++] = ESC_STUFF;
    } else {
      outArray[outIndex++] = inArray[i];
    }
  }
  return outArray;
}

// https://github.com/sorribas/varint.c
function varint_encode(n: number) : number[] {
  const a : number[] = [];

  while (n & ~0x7F) {
    a.push(n & 0xFF) | 0x80;
    n = n >> 7;
  }
  a.push(n);
  return a;
}

function hexFormat(arg) {
  if (typeof(arg) !== 'object') {
    arg = Buffer.from([arg]);
  }
  return arg.toString('hex').replace(/../g, '0x$&, ').trim().slice(0, -1);
}

let lastDebugMessage = 'lastDebugMessage initializer';
let lastDebugMessageTag = 'lastDebugMessageTag initializer';
function debugLog(pA:BigAssFans_i6PlatformAccessory, logTag:string|string[], logLevel:number|number[], logMessage:string) {
  if (typeof(logTag) === 'string') {
    if (pA.debugLevels[logTag] === undefined) {
      hbLog.warn('no such logging tag: "' + logTag + '", the message from ' + pA.Name + ' is: "' + logMessage + '"');
    } else {
      if (pA.debugLevels[logTag] >= logLevel) {
        hbLog.debug('dblog ' + logTag + '(' + logLevel + '/'  + pA.debugLevels[logTag] + ') ' + pA.Name + ' - ' +  logMessage);
      }
    }
  } else {
    for (let i = 0; i < logTag.length; i++) {
      if (pA.debugLevels[logTag[i]] === undefined) {
        hbLog.warn('no such logging tag: "' + logTag[i] + '", the message from ' + pA.Name + ' is: "' + logMessage + '"');
      } else {
        if (pA.debugLevels[logTag[i]] >= logLevel[i]) {
          if (lastDebugMessage === logMessage && lastDebugMessageTag !== logTag[i]) {
            // ignore it, it's redundant
            return;
          }
          hbLog.debug('dblog ' + logTag[i] + '(' + logLevel[i] + '/' + pA.debugLevels[logTag[i]] + ') ' + pA.Name + ' - ' +  logMessage);
          lastDebugMessage = logMessage;
          lastDebugMessageTag = logTag[i];
        }
      }
    }
  }
}

const messagesLogged:string[] = [];

function debugLogOnce(pA:BigAssFans_i6PlatformAccessory, logTag:string|string[], logLevel:number|number[], logMessage:string) {
  if (messagesLogged.includes(logMessage)) {
    debugLog(pA, 'newcode', 2, 'redundant message: "' + logMessage + '"');
    return;
  } else {
    debugLog(pA, logTag, logLevel, logMessage);
    messagesLogged.push(logMessage);
  }
}

function infoLogOnce(pA:BigAssFans_i6PlatformAccessory, logMessage: string) {
  if (messagesLogged.includes(logMessage)) {
    debugLog(pA, 'newcode', 2, 'redundant message: "' + logMessage + '"');
    return;
  } else {
    hbLog.info(pA.Name + ' - ' + logMessage);
    messagesLogged.push(logMessage);
  }
}

function clientWrite(client, b, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'network', 7, 'sending ' + b.toString('hex'));
  try  {
    client.write(b);
  } catch {
    // hbLog.warn('clientWrite(' + client + ', ' + b.toString('hex') + ') failed');
    hbLog.warn(pA.Name + ' - clientWrite(..., ' + b.toString('hex') + ') failed');
  }
}

function getVarint2(b: Buffer): [Buffer, number] {
  let r = 0;
  const a: number[] = [];

  for (let index = 0; index < b.length; index++) {
    if (b[index] & 0x80) {
      a.push(b[index] & 0x7f);
    } else {
      a.push(b[index] & 0x7f);
      break;
    }
  }

  for (let index = a.length - 1; index >= 0; index--) {
    r = (r << 7) | a[index];
  }

  return [b.subarray(a.length), r];
}

function getProtoElements2(b: Buffer): [Buffer, number, number] {
  // key is a varint
  let key = 0;
  const a: number[] = [];

  for (let index = 0; index < b.length; index++) {
    if (b[index] & 0x80) {
      a.push(b[index] & 0x7f);
    } else {
      a.push(b[index] & 0x7f);
      break;
    }
  }

  for (let index = a.length - 1; index >= 0; index--) {
    key = (key << 7) | a[index];
  }

  return [b.subarray(a.length), key & 0x07,  key >>> 3];
}

function doChunk(b:Buffer, pA: BigAssFans_i6PlatformAccessory) {

  let type: number;
  let field: number;
  let length: number;
  let s:string, v: number;

  [b, type, field] = getProtoElements2(b);
  if (field === 2) { // top level
    [b, length] = getVarint2(b);

    [b, type, field] = getProtoElements2(b);

    while (b.length > 0) {
      if (field === 4) {  // level 2
        [b, length] = getVarint2(b);

        const remainingLength = (b.length) - length;
        while (b.length > remainingLength) {
          [b, type, field] = getProtoElements2(b);
          if (field === 2) {
            [b, length] = getVarint2(b);
            [b, type, field] = getProtoElements2(b);
            switch (field) {
              case 2: // product type
                [b, s] = getString(b);
                productType(s, pA);
                break;
              case 7: // firmware version (sometimes zero-length?!)
                [b, s] = getString(b);
                firmwareVersion(s, pA);
                break;
              case 43:  // fan on/off/auto
                [b, v] = getValue(b);
                fanOnState(v, pA);
                break;
              case 44:  //  rotation direction
                [b, v] = getValue(b);
                fanRotationDirection(v, pA);
                break;
              case 46:  // fan rotation speed
                [b, v] = getValue(b);
                fanRotationSpeed(v, pA);
                break;
              case 58:  // whoosh
                [b, v] = getValue(b);
                whooshOnState(v, pA);
                break;
              case 65:  // eco mode (haiku)
                [b, v] = getValue(b);
                ecoModeOnState(v, pA);
                break;
              case 68:  // light on/off/auto
                [b, v] = getValue(b);
                lightOnState(v, pA);
                break;
              case 69:  // light brightness
                [b, v] = getValue(b);
                lightBrightness(v, pA);
                break;
              case 71:  // color temperature
                [b, v] = getValue(b);
                lightColorTemperature(v, pA);
                break;
              case 77:  // light dim to warm
                [b, v] = getValue(b);
                dimToWarmOnState(v, pA);
                break;
              case 82: // lightSelector?
                [b, v] = getValue(b);
                // lightSelector(v, pA);
                break;
              case 86:  // temperature
                [b, v] = getValue(b);
                currentTemperature(v / 100, pA);
                break;
              case 87:  // humidity
                [b, v] = getValue(b);
                currentRelativeHumidity(v / 100, pA);
                break;

              // unimplemented numbers
              case 66:  // occupancy detection (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
              case 85:  // light_occupancy_detected (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
                [b, v] = getValue(b); // ignore for now
                break;


              // ignore strings
              case 1: // name
              case 4: // local datetime
              case 5: // zulu datetime
              case 8: // MAC address
              case 10:  // fan's UUID
              case 11:  // website - api.bigassfans.com
              case 120: // IP address
                [b, s] = getString(b);  // ignore
                break;

              // ignore numbers
              case 45:  // fan speed as %
              case 47:  // fan auto comfort
              case 48:  // comfort ideal temperature
              case 50:  // comfort min speed
              case 51:  // comfort max speed
              case 52:  // fan auto -> motion -> motion sense switch
              case 53:  // fan auto -> motion -> motion timeout (time)
              case 54:  // fan return to auto (return to auto switch)
              case 55:  // fan return to auto (return after)
              case 60:  // comfort heat assist
              case 63:  // [target per aiobafi6] revolutions per minute
              case 70:  // brightness as level (0,1-16)
              case 73:  // light auto motion timeout (time)
              case 74:  // light return to auto (return to auto switch)
              case 75:  // light return to auto (return after
              case 78:  // warmest color temperature
              case 79:  // coolest color temperature
              case 134: // LED indicators
              case 135: // fan beep
              case 136: // legacy_ir_remote_enable (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto) [haiku only?]
              case 150: // prevent additional controls
                [b, v] = getValue(b); // ignore
                break;

              // mystery strings
              case 6:
              case 9:
              case 13:  // api version (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
              case 37:
              case 56:
              case 59:
              case 76:
              case 83:
              case 156: // stats (uptime)  (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto) but aiobafi6 says int32
                [b, s] = getString(b);
                debugLog(pA, 'cluing', 6, 'field ' + field + ', mystery string: ' + s);
                break;

              // mystery numbers
              case 3:
              case 14:
              case 15:
              case 24:
              case 25:
              case 26:
              case 27:
              case 28:
              case 29:
              case 30:
              case 31:
              case 32:
              case 33:
              case 49:
              case 57:
              case 61:  // comfort_heat_assist_speed (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
              case 62:  // comfort_heat_assist_reverse_enable (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
              case 64:  // current_rpm (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
              case 72:
              // case 82:
              /* falls through */
              case 89:
              case 118:
              case 121:
              case 133:
              case 137:
              case 138:
              case 140:
              case 151:
              case 153:
              case 172:
              case 173:
              case 174:
              case 175:
                [b, v] = getValue(b);
                debugLog(pA, 'cluing', 6, 'field ' + field + ', mystery number: ' + v);
                break;

              case 124: { // WiFi messages
                [b, length] = getVarint2(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements2(b);
                  switch (field) {
                    case 1: // SSID
                      [b, s] = getString(b); // ignore
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, WiFi messages field: "' + field + '"');
                      b = b.subarray(b.length - remainingLength);
                      break;
                  }
                }
                break;
              }

              case 16:  // firmware (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
              case 152: { // remote_firmware (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
                [b, length] = getVarint2(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements2(b);
                  switch (field) {
                    case 1:
                      [b, v] = getValue(b); // ignore
                      break;
                    case 2:
                    case 3:
                    case 4:
                      [b, s] = getString(b); // ignore
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, field 16 or 152 message with subfield: "' + field + '"');
                      b = b.subarray(b.length - remainingLength);
                      break;
                  }
                }
                break;
              }

              case 17: { // capabilities (include light pressence)
                let hasBulb = false;
                [b, length] = getVarint2(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements2(b);
                  switch (field) {
                    case 1:
                    case 3:
                    case 7:
                    case 9:
                    case 10:
                    case 14:
                      [b, v] = getValue(b);  // ignore
                      break;

                    case 2: // bulb equipped for 3rd Gen Haiku H/I Series?
                      debugLog(pA, 'cluing', 1, 'bulb equipped for 3rd Gen Haiku H/I Series?');
                      // falls through
                    case 4:
                      [b, v] = getValue(b);  // bulb equipped?
                      if (v === 1) {
                        hasBulb = true;
                      } else {
                        debugLog(pA, 'redflags', 1, 'unexpected bulb pressence value: ' + v);
                      }
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, field 17 message with subfield: "' + field + '"');
                      b = b.subarray(b.length - remainingLength);
                      break;
                  }
                }
                bulbPresent(hasBulb, pA);
                break;
              }


              case 171: { // something to do with a "group" including group name
                [b, length] = getVarint2(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements2(b);
                  switch (field) {
                    case 2:
                      [b, s] = getString(b);  // ignore
                      break;
                    case 3:
                      [b, s] = getString(b);  // ignore
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, field 171 message with subfield: "' + field + '"');
                      b = b.subarray(b.length - remainingLength);
                      break;
                  }
                }
                break;
              }

              default:
                debugLog(pA, 'cluing', 1, 'fell into default, field: "' + field + '"');
                b = doUnknownField(b, type, pA);
                break;
            }
          } else if (field === 3) {  // schedule
            [b, length] = getVarint2(b);
            const residualLength = (b.length) - length;
            while (b.length > residualLength) {
              [b, type, field] = getProtoElements2(b);
              switch (field) {
                case 1:
                case 3:
                case 4:
                  [b, v] = getValue(b); // ignore
                  break;
                case 2: {
                  [b, length] = getVarint2(b);
                  const residualLength = (b.length) - length;
                  while (b.length > residualLength) {
                    [b, type, field] = getProtoElements2(b);
                    switch (field) {
                      case 2:
                      case 4:
                        [b, s] = getString(b);  // ignore
                        break;
                      case 5:
                        [b, v] = getValue(b); // ignore
                        break;
                      case 7: {
                        [b, length] = getVarint2(b);
                        const residualLength = (b.length) - length;
                        while (b.length > residualLength) {
                          [b, type, field] = getProtoElements2(b);
                          switch (field) {
                            case 1:
                              [b, s] = getString(b);  // ignore
                              break;
                            case 2: {
                              [b, length] = getVarint2(b);
                              const residualLength = (b.length) - length;
                              while (b.length > residualLength) {
                                [b, type, field] = getProtoElements2(b);
                                switch (field) {
                                  case 1:
                                    [b, v] = getValue(b); // ignore
                                    break;

                                  default:
                                    debugLog(pA, 'cluing', 1, 'unknown schedule field ' + field);
                                }
                              }
                              break;
                            }

                            default:
                              debugLog(pA, 'cluing', 1, 'unknown schedule field ' + field);
                              break;
                          }
                        }
                        break;
                      }

                      default:
                        debugLog(pA, 'cluing', 1, 'unknown schedule field ' + field);
                        break;
                    }
                  }
                  break;
                }

                default:
                  debugLog(pA, 'cluing', 1, 'unknown schedule field ' + field);
                  break;
              }
            }
          } else {
            debugLog(pA, 'cluing', 1, 'unexpected sub level 2 field: ' + field);
          }
        }
      } else if (field === 5) { // seconds since unix epoch
        [b, v] = getValue(b); // ignore
      } else if (field === 6) { // 32-byte hash
        [b, s] = getString(b);  // ignore
      } else {
        debugLog(pA, 'cluing', 1, 'surprise field: ' + field);
      }

      if (b.length > 0) {
        [b, type, field] = getProtoElements2(b);
      }
    }
  } else {
    debugLog(pA, 'redflags', 1, 'top level message, expected field "2", got field "' + field + '"');
  }
}

function doUnknownField(b: Buffer, type: number, pA: BigAssFans_i6PlatformAccessory) {
  if (type === 0) {
    let value: number;
    [b, value] = getVarint2(b);
    debugLog(pA, 'cluing', 1, ' value: ' + value);
  } else if (type === 1) {
    debugLog(pA, 'cluing', 1, ' value: ' + hexFormat(b.subarray(0, 8)));
    b = b.subarray(8);
  } else if (type === 2) {
    let length: number;
    [b, length] = getVarint2(b);
    debugLog(pA, 'cluing', 1, ' length: ' + length);
    b = b.subarray(length);
  } else if (type === 3 || type === 4) {
    debugLog(pA, 'cluing', 1, ' deprecated group type');
  } else if (type === 5) {
    debugLog(pA, 'cluing', 1, ' value: ' + hexFormat(b.subarray(0, 4)));
    b = b.subarray(4);
  }
  return b;
}

function getString(b: Buffer) : [Buffer, string] {
  let length: number;
  [b, length] = getVarint2(b);
  return [b.subarray(length), b.subarray(0, length).toString()];
}

function getValue(b: Buffer) : [Buffer, number] {
  let varInt: number;
  [b, varInt] = getVarint2(b);

  return [b, varInt];
}
