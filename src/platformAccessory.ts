/* eslint-disable no-multi-spaces */

import { Service, PlatformAccessory, CharacteristicValue, Logger } from 'homebridge';
import { BigAssFans_i6Platform } from './platform';

// https://stackoverflow.com/questions/38875401/getting-error-ts2304-cannot-find-name-buffer
declare const Buffer; // this seems to ward off typescripts whining about buffer methods such as length, etc.

let hbLog: Logger;

const MAXFANSPEED = 7;

// property table columns
const DECODEVALUEFUNCTION = 0;
const PROPERTYHANDLERFUNCTION = 1;

const ONEBYTEHEADER = [0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03];

const MODEL_i6 =       'i6';
const MODEL_HAIKU_L =  'Haiku L Series';
const MODEL_HAIKU_HI = 'Haiku H/I Series';

export class BigAssFans_i6PlatformAccessory {
  public fanService!: Service;
  public lightBulbService!: Service;
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
  public showDimToWarmSwitch = false;
  public dimToWarmSwitchOn = false;
  public showFanAutoSwitch = false;
  public fanAutoSwitchOn = false;
  public showLightAutoSwitch = false;
  public lightAutoSwitchOn = false;
  public showEcoModeSwitch = false;
  public ecoModeSwitchOn = false;

  public showTemperature = true;

  public IP: string;
  public MAC: string;
  public Name = 'naamloos';
  public ProbeFrequency = 60000;

  public modelUnknown = true;
  public firmwareUnknown = true;

  public Model = 'unknown model';
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
  /**
  * propertiesTable is a two-dimensional array indexed by a string representation of the fan status codes.
  * each sub-array contains a value decoder function and a handler function to act on that value per the property code.
  */
  propertiesTable = getPropertiesArray();

  constructor(
    public readonly platform: BigAssFans_i6Platform,
    public readonly accessory: PlatformAccessory,
  ) {
    hbLog = platform.log;
    this.IP = accessory.context.device.ip;
    this.MAC = accessory.context.device.mac;
    this.Name = accessory.context.device.name;

    for (const hdr in this.propertiesTable) {
      const a = hdr.split(',');
      if (a.length === 1) {
        this.oneByteHeaders.push(parseInt(hdr));
      }
    }

    // defaults and enumeration of debugging keys
    this.debugLevels['light'] = 0;
    this.debugLevels['cluing'] = 0;
    this.debugLevels['network'] = 0;
    this.debugLevels['newcode'] = 0;
    this.debugLevels['humidity'] = 0;
    this.debugLevels['progress'] = 0;
    this.debugLevels['redflags'] = 0;
    this.debugLevels['noopcodes'] = 0;
    this.debugLevels['characteristics'] = 0;

    if (this.accessory.context.device.debugLevels !== undefined) {
      for (const debugEntry of this.accessory.context.device.debugLevels) {
        const entry:(string | number)[] = debugEntry as (string | number)[];
        this.debugLevels[entry[0]] = entry[1];
      }
    }

    if (accessory.context.device.whoosh) {
      this.showWhooshSwitch = true; // defaults to false in property initialization
    }
    if (accessory.context.device.dimToWarm) {
      this.showDimToWarmSwitch = true; // defaults to false in property initialization
    }
    if (accessory.context.device.fanAuto) {
      this.showFanAutoSwitch = true; // defaults to false in property initialization
    }
    if (accessory.context.device.lightAuto) {
      this.showLightAutoSwitch = true; // defaults to false in property initialization
    }
    if (accessory.context.device.ecoMode) {
      this.showEcoModeSwitch = true;  // defaults to false in property initialization
    }

    if (accessory.context.device.probeFrequency !== undefined) {
      this.ProbeFrequency = accessory.context.device.probeFrequency;
      debugLog(this, 'progress',  1, 'set ProbeFrequency to: ' + this.ProbeFrequency);
    }


    /**
    * set accessory information
    */

    debugLog(this, 'newcode', 1, 'user supplied model: ' + this.accessory.context.device.fanModel);
    if (this.accessory.context.device.fanModel !== undefined && this.accessory.context.device.fanModel !== 'other') {
      this.Model = this.accessory.context.device.fanModel;
    } else {
      this.Model = 'unknown';
    }

    const capitalizeName = accessory.context.device.name[0] === accessory.context.device.name[0].toUpperCase();
    let accessoryName:string;

    // why the '*' in the model characteristic, but not in this.model? it's cosmetic to indicate where the model name came
    //  from ('*' user, no '*', the fan), but we want the class property to have the 'real' name regardless.
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Big Ass Fans')
      .setCharacteristic(this.platform.Characteristic.Model, this.Model + '*')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.MAC);

    debugLog(this, 'newcode', 1, 'this.Model: ' + this.Model + '*');

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

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection)
      .onSet(this.setRotationDirection.bind(this))
      .onGet(this.getRotationDirection.bind(this));

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
        hbLog.warn('fan speed > ' + MAXFANSPEED + ': ' + this.fanStates.RotationSpeed + ', setting to ' + MAXFANSPEED);
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
    debugLog(this, ['newcode', 'characteristics'], [1, 3], 'Set Characteristic ColorTemperature  -> ' + value);
    this.lightStates.ColorTemperature = Math.round(1000000/(value as number));
    const bigNumberArray = stuffed(makeBigAssNumberValues(this.lightStates.ColorTemperature));
    const firstPart = [0xc0, 0x12, bigNumberArray.length + 6, 0x12, bigNumberArray.length + 4, 0x1a,
      bigNumberArray.length + 2, 0xb8, 0x04];
    clientWrite(this.client, Buffer.from(firstPart.concat(bigNumberArray, 0xc0)), this);
  }

  async getColorTemperature(): Promise<CharacteristicValue> {
    const colorTemperature = Math.round(1000000 / this.lightStates.ColorTemperature);
    debugLog(this, ['newcode', 'characteristics'], [1, 4], 'Get Characteristic ColorTemperature -> ' + colorTemperature);
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
  pA.client = net.connect(31415, pA.IP, () => {
    debugLog(pA, 'progress', 2, 'connected!');
    pA.client.setKeepAlive(true);

    clientWrite(pA.client, Buffer.from([0xc0, 0x12, 0x02, 0x1a, 0x00, 0xc0]), pA);
  });

  let errHandler;

  pA.client.on('error', errHandler = (err) => {
    if (err.code === 'ECONNRESET') {
      hbLog.warn(pA.Name + '(' + pA.IP + ')' + ' network connection reset [ECONNRESET]. Attempting reconnect in 2 seconds.');
    } else if (err.code === 'EPIPE') {
      hbLog.warn(pA.Name + '(' + pA.IP + ')' + ' network connection broke [EPIPE]. Attempting reconnect in 2 seconds.');
    } else if (err.code === 'ETIMEDOUT') {
      hbLog.error(pA.Name + '(' + pA.IP + ')' + ' connection timed out [ETIMEDOUT].  '  +
        'Check that your fan has power and the correct IP is in json.config.');
      return;
    } else if (err.code === 'ECONNREFUSED') {
      hbLog.error(pA.Name + '(' + pA.IP + ')' + ' connection refused [ECONNREFUSED].  '  +
          'Check that the correct IP is in json.config.');
      return;
    } else if (err.code === 'ENETUNREACH') {
      hbLog.error(pA.Name + '(' + pA.IP + ')' + ' is unreachable [ENETUNREACH].  ' +
            'Check the correct IP is in json.config.');
      return;
    } else {
      hbLog.warn(pA.Name + '(' + pA.IP + ')' + ': Unhandled network error: ' + err.code + '.  Attempting reconnect in 2 seconds.');
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
    }, 2000);
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
        debugLog(pA, 'redflag', 1, 'succeeded: OldProtocolFlag flipped to true');
      }
    }
    onData(pA, data);
  });

  if (pA.ProbeFrequency !== 0) {
    // attempt to prevent the occassional socket reset.
    // sending the mysterious code that the vendor app seems to send once every 15s but I'll go with every minute -  didn't prevent it.
    // can try going to every 15 seconds like the vendor app seems to do. - didn't work
    // perhaps I need to call socket.setKeepAlive([enable][, initialDelay]) when I establish it above? - nope, didn't help
    // obviously, I don't understand this stuff.
    // now I got an EPIPE 5+ hours after a reset, and repeaated EPIPEs evert minute for the next 7 minutes, then one more after 4 minutes
    // then clear sailing for 1+ hours so far.
    setInterval(( )=> {
      if (pA.client !== undefined) {
        clientWrite(pA.client, Buffer.from([0xc0, 0x12, 0x04, 0x1a, 0x02, 0x08, 0x03, 0xc0]), pA);
      } else {
        debugLog(pA, 'network', 4, 'client undefined in setInterval callback');
      }
    }, pA.ProbeFrequency);
  }
}

function onData(platformAccessory: BigAssFans_i6PlatformAccessory, data: Buffer) {
  debugLog(platformAccessory, 'network', 12, 'raw (stuffed) data: ' + hexFormat(data));
  debugLog(platformAccessory, 'network', 8, 'accessory client got: ' + data.length + (data.length === 1 ? ' byte' : ' bytes'));

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
        //  hbLog.debug('start: ' + startIndex + ', end: ' + endIndex + ', length: ' + chunks[numChunks].length);
        numChunks++;
        startIndex = -1;
      }
    }
  }
  debugLog(platformAccessory, 'network', 11, 'raw (unstuffed) data: ' + hexFormat(unstuff(data, platformAccessory)));

  let messageArray:string[][];
  for (let i = 0; i < numChunks; i++) {
    messageArray = preProcess(platformAccessory, unstuff(chunks[i], platformAccessory));

    messageArray.sort(sortFunction);
    for (let j = 0; j < messageArray.length; j++) {
      debugLog(platformAccessory, 'newcode', 10, 'handle: ' + messageArray[j][0]);
      debugLog(platformAccessory, 'newcode', 12, 'handle: ' + messageArray[j]);

      const propertyHandlerFunction = platformAccessory.propertiesTable[messageArray[j][0]][PROPERTYHANDLERFUNCTION];
      if (propertyHandlerFunction === undefined) {
        hbLog.warn('undefined handler for:', messageArray[j][0]);
        continue;
      }
      propertyHandlerFunction(messageArray[j][1], platformAccessory, messageArray[j][0]);
    }
  }
}

function sortFunction(a, b) {
  if (a[0] === b[0]) {
    return 0;
  } else {
    return (a[0] < b[0]) ? -1 : 1;
  }
}

function preProcess(platformAccessory: BigAssFans_i6PlatformAccessory, data: typeof Buffer):string[][] {
  let len = 0;
  let propertyFields: typeof Buffer;

  const rawChunk = data;  // data buffer gets modified as we go along.  rawChunk is a copy of the unmodified buffer
  debugLog(platformAccessory, 'network', 12, 'dbg1: ' + hexFormat(rawChunk));

  // dealing with a protocol ambiguity (or my ignorance)
  // first byte is 0xc0
  // then a big-assed-number (number of remaining bytes in chunk) followed by 0x22
  // -then-
  // (a) possibly a big-assed-number (2nd-number-of-remaining-bytes-in-chunk) followed by 0x12 (or 1a?), the property+value-size,
  //   the property and values, repeated until the 2nd-number-of-remaining-bytes-in-chunk is consumed, then a 72-byte token-like-thing
  //   starting with 0x28
  //
  // -or-
  //
  // (b) possibly a big-assed-number (2nd-number-of-remaining-bytes-in-chunk) which is actually the the property+value-size, then the
  //   property and values.
  //
  // a simple text property has a one-byte property type of '0x12', so beware of a data chunk of case (b) that begins with a simple text
  // property like model-type.  E.g., 0xc0, 0x12, 0x50, 0x22, 0x05, 0x12, 0x03, 0x69, 0x36, 0x28, ..., 0xc0.  I've not seen that happen yet.

  // case (a) i6 example:
  //  0xc0, 0x12, 0x75, 0x22, 0x2b, 0x12, 0x03, 0xb8, 0x09, 0x01, 0x12, ..., 0x28, ..., 0xc0
  // case (b) i6 examples:
  //  0xc0, 0x12, 0x50, 0x22, 0x06, 0x1a, 0x04, 0x08, 0x03, 0x20, 0x10, 0x28, ..., 0xc0
  //  0xc0, 0x12, 0x7b, 0x22, 0x31, 0x1a, 0x2f, ..., 0x28, ..., 0xc0
  //  0xc0, 0x12, 0x4f, 0x22, 0x05, 0x12, 0x03, 0xda, 0x0a, 0x00, 0x28, ..., 0xc0

  // case (c) when there's a schedule

  // how to determine if it's case (a) or (b)?
  // getting to the 0x22 is straightforward.
  // if case (b) should satisify some assumptions:
  //   1) the value after 0x22 is a one-byte big-assed-number because we ASS-U-ME no property/value message is larger that 255 bytes.  thus
  //      post 0x22 data length < 255.
  //   2) the value after the one-byte big-assed-number is not 0x12 or 0x1a (start of property/value message) [see note above about
  //      simple text]
  //   3) the value after the 0x22 is the size of the single property/value message in the data chunk.
  //   4) that size plus remainingChunkSize + 1 (terminating 0xc0) == data.length

  if (data[0] !== 0xc0) {
    hbLog.warn('expected start of message chunk (0x0c), got: ' + hexFormat(data[0]));
    debugLog(platformAccessory, 'network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return [];
  }
  data = data.subarray(1); // remove 0xc0

  if (data[0] !== 0x12) {
    hbLog.warn('expected start of message header (0x12 or 0x1a), got: ' + hexFormat(data[0]));
    debugLog(platformAccessory, 'network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return [];
  }
  data = data.subarray(1); // remove 0x12

  // accumulate remaining size (bigAssNumber)
  let banArray:number[] = [];
  while (data.length > 0 && data[0] !== 0x22) { // field separator
    banArray.push(data[0]);
    data = data.subarray(1); // remove the byte we just consumed
  }
  const remainingChunkSize = bigAssNumber(Buffer.from(banArray));

  if (data.length !== (remainingChunkSize + 1)) { // add in the 0xc0
    hbLog.warn('this is not the chunk size we\'re looking for: ' + remainingChunkSize + ', actual: ' + data.length);
    debugLog(platformAccessory, 'network', 1, 'rawChunk: ' + hexFormat(rawChunk));
    debugLog(platformAccessory, 'network', 1, 'data remaining: ' + hexFormat(data));
    return [];
  }
  if (data.length === 0 || data[0] !== 0x22) {
    hbLog.warn('not good.  apparently we ran off the end of the data buffer');
    debugLog(platformAccessory, 'network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return [];
  }
  data = data.subarray(1); // remove the field separator (0x22)

  // if it's the new (circa 4/4/2022) Haiku firmware then the mystery (token?) data at the end of the chunk isn't present

  const tokenLength = platformAccessory.OldProtocolFlag ? 72 : 0;

  let chunkSizeSansToken:number;
  // let ignoredBytes = 0;

  // data[0] is remaining chunk size
  // data[1] is 0x12 or 0x1a
  // data[2] is size of 1st (and only) property message
  // ((data[0] - data[2]) === 2) // starting byte (0x1a) terminating byte (0xc0)
  // (data.length == data[2] + tokenLength + 4) // +4: <chunkSizeSansToken byte> + 0x1a + data[2] byte + 0xc0

  // if (remainingChunkSize === (data[2] + 2) + tokenLength + 2) {
  //   debugLog(platformAccessory, 'newcode', 1, 'solo!')
  // }

  if (data.length === (data[2] + tokenLength + 4))  { // this is the sole message in the chunk
    if (data[1] !== 0x1a) {
      if (data[1] === 0x12) { // we're going to skip the sole message, therefore we're skipping the entire chunk
        debugLogOnce(platformAccessory, 'redflags', 2, 'ignoring chunk with sole message: ' + hexFormat(data.subarray(1, data[0]+1)));
        return [];
      }
      debugLog(platformAccessory, 'redflags', 1, 'sole message in a chunk is not 0x1a or 0x12, but rather: ' + hexFormat(data[1]));
    }

    chunkSizeSansToken = data[0] + 2; // +1 for the 0x12 we're going to insert at the beginning, and 1 for the final 0xc0
    // stuff a start byte (0x12) to make everything copacetic down the road
    data = Buffer.concat([Buffer.from([0x12]), data]);
  } else {
    // accumulate remaining size (bigAssNumber)
    banArray = [];
    while (data.length > 0 && data[0] !== 0x12) {  // apparently 0x12 can not be part of this bigAssNumber?
      banArray.push(data[0]);
      data = data.subarray(1); // remove the byte we just consumed
    }
    chunkSizeSansToken = bigAssNumber(Buffer.from(banArray));
  }

  const assumedChunkSize = chunkSizeSansToken + tokenLength + 1; // the "+ 1" is for the terminating 0xc0

  // this assertion about the remaining data length may be entirely unnecessary
  if (data.length !== assumedChunkSize) {
    if (data.length === (assumedChunkSize + 72)) {
      debugLog(platformAccessory, 'redflags', 1, 'would be chunkSizeSansToken warning averted');
      if (platformAccessory.OldProtocolFlag === undefined) {
        debugLog(platformAccessory, 'redflags', 1, 'platformAccessory.OldProtocolFlag === undefined');
      } else {
        debugLog(platformAccessory, 'redflags', 1, 'OldProtocolFlag: ' + platformAccessory.OldProtocolFlag);
      }
    } else {
      hbLog.warn('chunkSizeSansToken: ' + assumedChunkSize + ', not what we expected with data length: ' + data.length);
      debugLog(platformAccessory, 'redflags', 1, 'OldProtocolFlag: ' + platformAccessory.OldProtocolFlag);
      debugLog(platformAccessory, 'redflags', 1, 'rawChunk: ' + hexFormat(rawChunk));

      return [];
    }
  }

  const processedMessageArray:string[][] = [];
  /**
  * pick out the property code and send it to the decode function to get the value from its
  * coded field.  Then call the property's handler function to act on the message's contents (or not.)
  */
  while (data[0] !== 0xc0) {
    if (data[0] === 0x28) { // 0x28 is the start of what looks like a token 72 bytes long followed by 0xc0 end of chunk.
      if (data.length === 73) {
        return processedMessageArray;
      } else {
        debugLog(platformAccessory, 'redflags', 3, 'surprise! token length was: ' + data.length);
      }
    }
    if (data[0] !== 0x12) {
      hbLog.warn('expected 0x12, got: ', hexFormat(data.subarray(0, 1)));
      debugLog(platformAccessory, 'redflags', 3, 'unexpected byte in chunk:  ' + hexFormat(data) + ' from: ' + hexFormat(rawChunk));
      return processedMessageArray;
    }
    data = data.subarray(1);  // remove the 'start of header' (0x12) from the remaining data

    len = data[0];
    data = data.subarray(1);  // remove the 'length' byte from the remaining data

    propertyFields = data.subarray(0, len); // this is the message - property code and value
    data = data.subarray(len);  // remove the message from the remaining data

    let hdrsize = 2; // most property headers are two bytes
    if (platformAccessory.oneByteHeaders.includes(propertyFields[0])) {
      hdrsize = 1;
    }

    const propertyCodeString = hexFormat(propertyFields.subarray(0, hdrsize));
    const propertyValueField = propertyFields.subarray(hdrsize);

    if (platformAccessory.propertiesTable[propertyCodeString] === undefined) {
      hbLog.warn('propertiesTable[' + propertyCodeString + '] === undefined');
      continue;
    }

    const decodeValueFunction = platformAccessory.propertiesTable[propertyCodeString][DECODEVALUEFUNCTION];
    if (decodeValueFunction === undefined) {
      hbLog.warn('No value decoding function for: ', propertyCodeString);
    }

    // the propertiesTable declaration for the decode value functions to have platform accessory and string arguments.
    // we pass the arguments whether or not a given function requires them just in case we want to, for example, add a debugLog call
    // in a given function.
    const decodedValue = decodeValueFunction(propertyValueField, platformAccessory, 'noop');
    if (decodedValue === undefined) {
      hbLog.warn('Could not decode value for: ', propertyCodeString);
      continue;
    }

    // some unknown codes might be under surveillance - check if this is one of them?
    codeWatch(propertyCodeString, decodedValue, propertyValueField, platformAccessory);

    const propertyHandlerFunction = platformAccessory.propertiesTable[propertyCodeString][PROPERTYHANDLERFUNCTION];
    if (propertyHandlerFunction === undefined) {
      hbLog.warn('undefined handler for:', propertyCodeString);
      continue;
    }

    // propertyHandlerFunction(decodedValue, platformAccessory, propertyCodeString);
    processedMessageArray.push([propertyCodeString, decodedValue]);
  }
  return processedMessageArray;
}

// Property Table
function getPropertiesArray():typeof properties {
  // some gymnastics here to get past lint
  const properties: (((v: number | string, p: BigAssFans_i6PlatformAccessory, s: string) => void) |
  ((b: Buffer|string, p: BigAssFans_i6PlatformAccessory) => string))[][] = [];
  // many of the same codes occur in multiple chunks  (or in the same chunk?)
  properties['0x0a'] =       [text3Value,     noopName];                //  name
  properties['0x12'] =       [textValue,      getModel];                //  model
  properties['0x1a'] =       [dataValue,      mysteryCode],             //  something to do with schedules
  properties['0x18, 0xc0'] = [dataValue,      mysteryCode];             //  mystery
  properties['0x22'] =       [textValue,      noopDateTime];            //  local datetime
  properties['0x2a'] =       [textValue,      noopDateTime];            //  zulu datetime
  properties['0x32'] =       [textValue,      noopDateTime];            //  mystery datetime
  properties['0x3a'] =       [textValue,      firmwareVersion];         //  firmware version (sometimes zero-length?!)
  properties['0x42'] =       [textValue,      noopMacAddress];          //  MAC address
  properties['0x4a'] =       [textValue,      noopToken];               //  mystery - token
  properties['0x52'] =       [textValue,      noopToken];               //  mystery - token
  properties['0x5a'] =       [textValue,      noopWebSite];             //  website - api.bigassfans.com
  properties['0x6a, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0x70'] =       [intValue,       mysteryCode];             //  mystery
  properties['0x78'] =       [intValue,       mysteryCode];             //  mystery
  properties['0x80, 0x02'] = [intValue,       mysteryCode];             //  mystery
  properties['0x80, 0x03'] = [weatherValue,   noopComfortIdealTemp];    //  comfort ideal temperature
  properties['0x80, 0x04'] = [intValue,       mysteryCode];             //  mystery
  properties['0x82, 0x01'] = [text4Value,     noopVersion];             //  mystery xware
  properties['0x88, 0x02'] = [intValue,       mysteryCode];             //  mystery
  properties['0x88, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0x88, 0x04'] = [intValue,       ecoModeOnState];          //  eco mode (haiku)
  properties['0x8a, 0x01'] = [dataValue,      capabilities];            //  mystery (haiku)
  properties['0x90, 0x03'] = [intValue,       noop];                    //  comfort min speed
  properties['0x90, 0x05'] = [intValue,       mysteryCode];             //  mystery (haiku)
  properties['0x9a, 0x05'] = [dataValue,      mysteryCode];             //  mystery (haiku)
  properties['0x98, 0x03'] = [intValue,       noop];                    //  comfort max speed
  properties['0xa0, 0x03'] = [boolValue,      noop];                    //  fan auto -> motion -> motion sense switch
  properties['0xa0, 0x04'] = [onOffAutoValue, lightOnState];            //  light on/off/auto
  properties['0xa8, 0x03'] = [varIntValue,    noop];                    //  fan auto -> motion -> motion timeout (time)
  properties['0xa8, 0x04'] = [intValue,       lightBrightness];         //  light brightness
  properties['0xa8, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xaa, 0x02'] = [textValue,      mysteryCode];             //  mystery (haiku)
  properties['0xb0, 0x03'] = [boolValue,      noop];                    //  fan return to auto (return to auto switch)
  properties['0xb0, 0x04'] = [intValue,       noop];                    //  brightness as level (0,1-16)
  properties['0xb0, 0x05'] = [weatherValue,   currentTemperature];      //  temperature
  properties['0xb0, 0x07'] = [intValue,       mysteryCode];             //  mystery
  properties['0xb0, 0x08'] = [boolValue,      noop];                    //  LED indicators
  properties['0xb0, 0x09'] = [boolValue,      noop];                    //  prevent additional controls
  properties['0xb8, 0x03'] = [varIntValue,    noop];                    //  fan return to auto (return after)
  properties['0xb8, 0x04'] = [varIntValue,    lightColorTemperature];   //  color temperature
  properties['0xb8, 0x05'] = [weatherValue,   currentRelativeHumidity]; //  humidity
  properties['0xb8, 0x08'] = [boolValue,      noop];                    //  fan beep
  properties['0xb8, 0x09'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc0, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc0, 0x04'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc0, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc2, 0x03'] = [textValue,      mysteryCode];             //  mystery
  properties['0xc2, 0x07'] = [textValue,      noop];                    //  IP address
  properties['0xc2, 0x09'] = [dataValue,      mysteryCode];             //  mystery MAC address with or w/o firmware versions (text6/text7)
  properties['0xc8, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc8, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc8, 0x04'] = [varIntValue,    noop];                    //  light auto motion timeout (time)
  properties['0xc8, 0x05'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc8, 0x07'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc8, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xc8, 0x09'] = [intValue,       mysteryCode];             //  mystery (haiku)
  properties['0xd0, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xd0, 0x03'] = [boolValue,      whooshOnState];           //  whoosh
  properties['0xd0, 0x04'] = [boolValue,      noop];                    //  light return to auto (return to auto switch)
  properties['0xd0, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xd8, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xd8, 0x02'] = [onOffAutoValue, fanOnState];              //  fan on/off/auto
  properties['0xd8, 0x04'] = [varIntValue,    noop];                    //  light return to auto (return after)
  properties['0xda, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0xda, 0x0a'] = [intValue,       mysteryCode];             //  something to do with a "group" including group name
  properties['0xdb, 0xdc'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe0, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe0, 0x02'] = [boolValue,      fanRotationDirection];    //  rotation direction
  properties['0xe0, 0x03'] = [boolValue,      noop];                    //  comfort heat assist
  properties['0xe0, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe0, 0x0a'] = [intValue,       mysteryCode];             //  mystery (haiku)
  properties['0xe2, 0x04'] = [textValue,      mysteryCode];             //  mystery
  properties['0xe2, 0x07'] = [text2Value,     noop];                    //  SSID
  properties['0xe2, 0x09'] = [dataValue,      mysteryCode];             //  mystery (haiku)
  properties['0xe8, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe8, 0x02'] = [intValue,       noop];                    //  fan speed as %
  properties['0xe8, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe8, 0x04'] = [boolValue,      dimToWarmOnState];        //  light dim to warm
  properties['0xe8, 0x0a'] = [dataValue,      mysteryCode];             //  mystery (haiku)
  properties['0xf0, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xf0, 0x02'] = [intValue,       fanRotationSpeed];        //  fan rotation speed
  properties['0xf0, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0xf0, 0x04'] = [varIntValue,    noop];                    //  warmest color temperature
  properties['0xf0, 0x0a'] = [dataValue,      mysteryCode];             //  mystery (haiku)
  properties['0xf8, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xf8, 0x02'] = [boolValue,      noop];                    //  fan auto comfort
  properties['0xf8, 0x03'] = [intValue,       noop];                    //  revolutions per minute
  properties['0xf8, 0x04'] = [varIntValue,    noop];                    //  coolest color temperature
  properties['0xf8, 0x0a'] = [intValue,       mysteryCode];             //  mystery (haiku)

  /*
  // the following props in sean9keenan's 'homebridge-bigAssFans createGetField are not listed above - might be in the mystery category
  // LIGHT;LEVEL;MIN
  // LIGHT;LEVEL;MAX
  // DEVICE;LIGHT;PRESENT
  // SNSROCC;STATUS;OCCUPIED|UNOCCUPIED
  // SNSROCC;TIMEOUT;MIN
  // SNSROCC;TIMEOUT;MAX
  // SMARTMODE;ACTUAL;OFF|COOLING|HEATING
  // SMARTMODE;STATE;LEARN;COOLING;HEATING;FOLLOWSTAT
  // LEARN;STATE;LEARN|OFF
  // LEARN;MINSPEED
  // LEARN;MAXSPEED
  // LEARN;ZEROTEMP
  // SLEEP;STATE;ON|OFF
  // SMARTSLEEP;MINSPEED
  // SMARTSLEEP;MAXSPEED
  // WINTERMODE;STATE;ON|OFF
  // WINTERMODE;HEIGHT
  // NW;TOKEN
  // NW;DHCP;ON|OFF
  // FW;FW00003
  // NW;AP;ON|OFF
  */
  return properties;
}

/**
* property handler functions
*/

function capabilities(value: string, pA:BigAssFans_i6PlatformAccessory) {
  // it's a stretch to think I can parse this.  So far I've only seen it on Haikus
  // wojo fan with light
  // 0x12, 0x11, 0x8a, 0x01, 0x0e, 0x08, 0x01, 0x18, 0x01, 0x20, 0x01, 0x38, 0x01, 0x48, 0x01, 0x50, 0x01, 0x70, 0x01
  // wojo fan without light
  // 0x12, 0x0f, 0x8a, 0x01, 0x0c, 0x08, 0x01, 0x18, 0x01, 0x38, 0x01, 0x48, 0x01, 0x50, 0x01, 0x70, 0x01
  // Klidec
  // 0x12, 0x11, 0x8a, 0x01, 0x0e, 0x08, 0x01, 0x18, 0x01, 0x20, 0x01, 0x38, 0x01, 0x48, 0x01, 0x50, 0x01, 0x70, 0x01,
  if (value.indexOf('0x20, 0x01') === -1) {
    infoLogOnce(pA, 'no light detected');
    const service = pA.accessory.getService(pA.platform.Service.Lightbulb);
    if (service) {
      pA.accessory.removeService(service);
    }
  } else {
    infoLogOnce(pA, 'light detected');
  }
}

function getModel(value: string, pA:BigAssFans_i6PlatformAccessory) {

  const regex = /[ -~]/g;  // count the printable characters
  const found = value.match(regex);
  if (found === null || (found.length !== value.length)) {
    debugLogOnce(pA, 'redflags', 1, 'Unexpected characters in model name: ' + hexFormat(Buffer.from(value, 'utf8')));
    return;
  }

  if (pA.modelUnknown) {  // need to do this only once
    pA.modelUnknown = false;

    if (pA.accessory.context.device.devModelOverride) {
      debugLog(pA, 'progress', 0, 'overriding model "' + value + '" with "' + pA.accessory.context.device.devModelOverride + '"');
      value = pA.accessory.context.device.devModelOverride;
    }
    pA.Model = value;
    debugLog(pA, 'progress', 0, 'model: ' + pA.Model + ' (' + hexFormat(Buffer.from(value, 'utf8')) + ')');

    pA.accessory.getService(pA.platform.Service.AccessoryInformation)!
      .setCharacteristic(pA.platform.Characteristic.Model, pA.Model);

    if (pA.Model === MODEL_HAIKU_HI || pA.Model === MODEL_HAIKU_L) {
      // this.lightBulbService.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      //   .removeAllListeners('set')
      //   .removeAllListeners('get');
      debugLog(pA, 'newcode', 1, 'no ColorTemperature Characteristic for model "' + pA.Model + '"');
      pA.lightBulbService.removeCharacteristic(pA.lightBulbService.getCharacteristic(pA.platform.Characteristic.ColorTemperature));
    }

    if (pA.Model === MODEL_HAIKU_HI || pA.Model === MODEL_HAIKU_L) {
      const service = pA.accessory.getService(pA.platform.Service.HumiditySensor);
      if (service) {
        pA.accessory.removeService(service);
        debugLog(pA, 'newcode', 1, 'no HumiditySensor service for model "' + pA.Model + '"');
      }
    }

    if (pA.Model === MODEL_HAIKU_L) {
      const service = pA.accessory.getService(pA.platform.Service.TemperatureSensor);
      if (service) {
        pA.accessory.removeService(service);
        debugLog(pA, 'newcode', 2, 'no TemperatureSensor service for model "' + pA.Model + '"');
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

function noopDateTime(value: string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'noopcodes', 3, 'datetime: ' + value);
}

function noopVersion(value: string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'noopcodes', 2, 'version: ' + value);
}

function noopName(value: string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'noopcodes', 3, 'name: ' + value);
}

function noopMacAddress(value: string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'noopcodes', 3, 'MAC address: ' + value);
}

function noopWebSite(value: string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'noopcodes', 3, 'web site: ' + value);
}

function noopComfortIdealTemp(value: string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'noopcodes', 3, 'comfort ideal temperature: ' + value);
}

function noopToken(value: string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'noopcodes', 3, 'token: ' + value);
}


function lightColorTemperature(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  // some fans don't have ColorTemperature capability but they still send (static) values, should change propertyTable to call noop instead
  if (pA.Model !== MODEL_HAIKU_HI && pA.Model !== MODEL_HAIKU_L) {
    const mireds = Math.round(1000000 / pA.lightStates.ColorTemperature);
    pA.lightStates.ColorTemperature = Number(value);
    debugLog(pA, ['newcode', 'characteristics'], [1, 3], 'update ColorTemperature: ' + mireds);
    pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.ColorTemperature, mireds);
  } else {
    debugLog(pA, 'newcode', 1, 'ColorTemperature: ignored');
  }
}

function lightBrightness(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
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
  } else if (value === 2 && pA.lightAutoSwitchOn === false) {
    pA.lightAutoSwitchOn = true;
    debugLog(pA, ['light', 'characteristics'], [1, 3], 'update light auto switch on: ' + pA.lightAutoSwitchOn);
    pA.lightAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightAutoSwitchOn);
  }

  // if (value === 2 && pA.lightAutoSwitchOn) {
  //   pA.lightStates.On = true;
  //   debugLog(pA, 'light', 1, '(value === 2 && pA.lightAutoSwitchOn): ' + pA.lightStates.On);
  //   debugLog(pA, ['light', 'characteristics'], [1, 3], 'update Light On: ' + pA.lightStates.On);
  //   pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightStates.On);
  //   return;
  // }

  // pA.lightAutoSwitchOn = (value === 2) ? true: false;
  // if (pA.showLightAutoSwitch) {
  //   debugLog(pA, ['light', 'characteristics'], [1, 3], 'update light auto switch on: ' + pA.lightAutoSwitchOn);
  //   pA.lightAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightAutoSwitchOn);
  // }

  // if (value === 2 && pA.lightStates.On) {
  //   debugLog(pA, 'light', 1, 'ignore auto on value, the light is already on');
  //   return;
  // }

  // if (value === 2 && !pA.lightStates.On) { // light was off, auto switch was turned on, leave the light off
  //   return;
  // }

  // const onValue = (value === 0 ? false : true);
  // pA.lightStates.On = onValue;
  // debugLog(pA, ['light', 'characteristics'], [1, 3], 'update Light On: ' + pA.lightStates.On);
  // pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightStates.On);
}

function fanOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
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

function fanRotationDirection(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  //  fan reports if 'reverse rotation' is on or off, homebridge wants rotation direction
  //  reverse switch off (0) == rotation direction counterclockwise (1)
  const rotationDirection = value === 0 ? 1 : 0;
  pA.fanStates.RotationDirection = rotationDirection;
  debugLog(pA, 'characteristics', 3, 'update RotationDirection: ' + pA.fanStates.RotationDirection);
  pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationDirection, pA.fanStates.RotationDirection);
}

function fanRotationSpeed(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
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

function currentTemperature(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.accessory.context.device.showTemperature !== undefined && pA.accessory.context.device.showTemperature === false) {
    // should really replace this function with noop in property table in this case
    debugLog(pA, 'newcode', 1, 'ignoring temperature');
    return;
  }

  if (value < -270 || value > 100) {
    // Haiku L doesn't seem to support the temperature sensor, it just reports 1000º.  ignore it
    // should replace this function with noop in property table

    if (value === 1000) {
      infoLogOnce(pA, 'current temperature out of range: ' + value + ', assuming no temperature sensor for model "' + pA.Model + '"');
      return;
    } else {
      hbLog.info('current temperature out of range: ' + value + ', ignored');
    }
    return;
  }

  pA.CurrentTemperature = Number(value);
  debugLog(pA, 'characteristics', 3, 'update CurrentTemperature:' + pA.CurrentTemperature);
  pA.temperatureSensorService.updateCharacteristic(pA.platform.Characteristic.CurrentTemperature, pA.CurrentTemperature);
}

function currentRelativeHumidity(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'humidity', 2, pA.Name + ' - CurrentRelativeHumidity:' + value);

  if (value < 0 || value > 100) {
    // Haikus don't seem to support the humidity sensor, they just report 1000%.  ignore it
    // should replace this function with noop in property table
    if (value === 1000) {
      infoLogOnce(pA, 'Assuming no humidity sensor for model "' + pA.Model + '"');
      return;
    } else {
      hbLog.info('current relative humidity out of range: ' + value + ', ignored');
    }
    return;
  }

  pA.CurrentRelativeHumidity = Number(value);
  debugLog(pA, 'characteristics', 3, 'update CurrentRelativeHumidity:' + pA.CurrentRelativeHumidity);
  pA.humiditySensorService.updateCharacteristic(pA.platform.Characteristic.CurrentRelativeHumidity, pA.CurrentRelativeHumidity);
}

function whooshOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
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

function noop() {
  // this body intentionally left blank
}

// keeping track to gather clues in unending effort to ID unknown codes
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

/**
* value decoding functions
*/

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function testValue(bytes:Buffer): number|string {
  hbLog.debug('testValue(' + hexFormat(bytes) + ')');
  return('test');
}

function onOffAutoValue(bytes:Buffer): number|string|undefined {
  switch (bytes[0]) {
    case 0x00: // thing is off, auto is off
    case 0x01: // thing is on, may or may not be due to auto being on
    case 0x02: // auto is on fan may or may not be spinning
      return (bytes[0]);
    default:
      hbLog.warn('unknown value for \'on|off|auto\': ', hexFormat(bytes));
      return undefined;
  }
}

function boolValue(bytes:Buffer): number|string|undefined {
  switch (bytes[0]) {
    case 0x00:
    case 0x01:
      return(bytes[0]);
    default:
      hbLog.warn('unknown value for "on|off" or "direction": ' + hexFormat(bytes));
      return undefined;
  }
}

function intValue(bytes:Buffer): number|string {
  return(bytes.readUInt8());
}

function varIntValue(bytes:Buffer): number|string {
  return(bigAssNumber(bytes));
}

function textValue(bytes:Buffer): number|string {
  // <strlen> [<char>, ...]
  return(bytes.subarray(1).toString());
}

function text2Value(bytes:Buffer): number|string {
  return(bytes.subarray(3).toString());
}

function text3Value(bytes:Buffer): number|string {
  return(bytes.toString()); // i.e. subarray.toString();
}

function text4Value(bytes:Buffer): string {
  // value = 10 08 02 12 05 31 2e 37 2e 31 1a 05 31 2e 35 2e 30
  //                         1  .  7  .  1        1  .  5  .  1
  // 0x10 - length of total text components
  // 0x08 - ?
  // 0x02 - two components
  // 0x12 - start of components
  // 0x05 - 5 bytes for 1st component <31 2e 37 2e 31>
  // 0x1a - separator
  // 0x05 - 5 bytes for 2nd component <31 2e 35 2e 30>
  return(bytes.subarray(5, 10).toString() + ' ' + bytes.subarray(12).toString());
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function text5Value(bytes:Buffer): number|string {
  // value = 0e 12 05 31 2e 37 2e 31 1a 05 31 2e 37 2e 30
  // 0x0e - length of total text components
  // 0x12 - start
  // 0x05 - 5 bytes for 1st component <31 2e 37 2e 31>
  // 0x1a - separator
  // 0x05 - 5 bytes for 2nd component <31 2e 37 2e 30
  return(bytes.subarray(3, 8).toString() + ' ' + bytes.subarray(10).toString());
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function text6Value(bytes:Buffer): number|string {
  // value = 21 12 05 31 2e 37 2e 31 1a 05 31 2e 35 2e 30 22 11 39 42 3a 46 30 3a 36 41 3a 33 37 3a 38 44 3a 44 44
  // value = 13,22,11,39,42,3a,46,30,3a,36,41,3a,33,37,3a,38,44,3a,44,44,
  // 0x21 - length of total text components
  // 0x12 - start
  // 0x05 - 5 bytes for 1st component <31 2e 37 2e 31>
  // 0x1a - separator
  // 0x05 - 5 bytes for next component <31 2e 35 2e 30>
  // 0x22 - ?
  // 0x11 - 17 bytes for next component
  return(bytes.subarray(3, 8).toString() + ' ' + bytes.subarray(12, 15).toString() + ' ' + bytes.subarray(17).toString());
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function text7Value(bytes:Buffer): number|string {
  // value = 13,22,11,39,42,3a,46,30,3a,36,41,3a,33,37,3a,38,44,3a,44,44,
  // 0x13 - length
  // 0x22 - ?
  // 0x11 - -length
  // 9B:F0:6A:37:8D:DD
  return(bytes.subarray(3, 8).toString() + ' ' + bytes.subarray(12, 15).toString() + ' ' + bytes.subarray(17).toString());
}

function weatherValue(bytes:Buffer): number|string {
  return(bigAssNumber(bytes) / 100);
}

function dataValue(bytes:Buffer): string {
  return(hexFormat(bytes));
}

// a little hack for codes under investigation
function codeWatch(s: string, v: string|number|Buffer, m: Buffer, pA:BigAssFans_i6PlatformAccessory) {
  if (s === '0xe8, 0x01') {
    debugLog(pA, 'cluing', 4, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } if (s === '0xd8, 0x01') {
    debugLog(pA, 'cluing', 4, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } else if (s === '0x18, 0xc0') {
    debugLog(pA, 'cluing', 4, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } else if (s === '0xda, 0x0a') {
    debugLog(pA, 'cluing', 4, 'code watch - s: ' + s + ', v: ' + hexFormat(v));
  }
}

const ESC = 0xDB;
const START = 0xc0;
const ESC_STUFF = 0xDD;
const START_STUFF = 0xDC;

// 0xdb, 0xdc -> 0xc0
// 0xdb, 0xdd -> 0xdb

function unstuff(data:typeof Buffer, pA:BigAssFans_i6PlatformAccessory):typeof Buffer {
  const unstuffedData: number[] = [];
  if (data[0] !== START) {
    debugLog(pA, 'network', 1, 'data doesn\'t begin with START byte - all bets are off');
  } else {
    let dataIndex = 0;
    let unstuffedDataIndex = 0;
    unstuffedData[unstuffedDataIndex++] = data[dataIndex++];
    while (dataIndex < (data.length - 1)) {
      if (data[dataIndex] === ESC && data[dataIndex+1] === START_STUFF) {
        unstuffedData[unstuffedDataIndex++] = 0xc0;
        dataIndex += 2; // skip over the ESC and the START_STUFF
      } else if (data[dataIndex] === ESC && data[dataIndex+1] === ESC_STUFF) {
        unstuffedData[unstuffedDataIndex++] = 0xDB;
        dataIndex += 2; // skip over the ESC and the ESC_STUFF
      } else {
        unstuffedData[unstuffedDataIndex++] = data[dataIndex++];
      }
    }
    unstuffedData[unstuffedDataIndex] = data[dataIndex];  // better be c0! should check it?
  }
  return Buffer.from(unstuffedData);
}

function bigAssNumber(value: typeof Buffer) {
  let n = value[0];
  for (let i = 1; i < value.length; i++) {
    n += (value[i] - 1) * 128**i;
  }
  return n;
}

function stuffed(n: number) {
  const result = makeBigAssNumberValues(n);
  if (typeof(result) === 'number') {
    return [ result ];
  } else {
    const stuffedResult:number[] = [];
    let stuffedResultIndex = 0;
    if (result.length > 1) {
      for (let i = 0; i < result.length; i++) {
        if (result[i] === '0xc0') {
          stuffedResult[stuffedResultIndex++] = ESC;
          stuffedResult[stuffedResultIndex++] = START_STUFF;
        } else if (result[i] === '0xDB') {
          stuffedResult[stuffedResultIndex++] = ESC;
          stuffedResult[stuffedResultIndex++] = ESC_STUFF;
        } else {
          stuffedResult[stuffedResultIndex++] = result[i];
        }
      }
    }
    return stuffedResult;
  }
}

function makeBigAssNumberValues(n: number) {
  const a = [0];  // intialize it, then empty it to keep typescript from complaining about assigning to type never.
  a.pop();
  if (n > 255) {
    const b = Math.trunc(n/128);
    if (b > 255) {
      a.push(n % 256);
      return a.concat(makeBigAssNumberValues(b));
    } else {
      a.push(makeBigAssNumberValues(n - (b - 1) * 128));
      return a.concat(b);
    }
  } else {
    a.push(n);
    return a[0];
  }
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
    hbLog.info(logMessage);
    messagesLogged.push(logMessage);
  }
}

function clientWrite(client, b, pA:BigAssFans_i6PlatformAccessory) {
  debugLog(pA, 'network', 7, 'sending ' + b.toString('hex'));
  try  {
    client.write(b);
  } catch {
    // hbLog.warn('clientWrite(' + client + ', ' + b.toString('hex') + ') failed');
    hbLog.warn('clientWrite(..., ' + b.toString('hex') + ') failed');
  }
}
