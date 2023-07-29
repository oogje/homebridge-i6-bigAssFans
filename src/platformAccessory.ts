/* eslint-disable no-multi-spaces */

import { Service, PlatformAccessory, CharacteristicValue, Logger } from 'homebridge';
import { BigAssFans_i6Platform } from './platform';

// https://stackoverflow.com/questions/38875401/getting-error-ts2304-cannot-find-name-buffer
declare const Buffer; // this seems to ward off typescripts whining about buffer methods such as length, etc.

let hbLog: Logger;

const MAXFANSPEED = 7;

const ONEBYTEHEADER = [0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03];

// const MODEL_I6 =       'i6';
// const MODEL_ES6 =      'es6';
// const MODEL_HAIKU_L =  'Haiku L Series';
// const MODEL_HAIKU_HI = 'Haiku H/I Series';

const TARGETLIGHT_BOTH = 0;
const TARGETLIGHT_DOWN = 1;
const TARGETLIGHT_UP = 2;

interface lightStates {
  On: boolean;
  Brightness: number; // percent
  ColorTemperature: number;
  homeShieldUp: boolean;  // used to prevent Home.app from turning light on at 100% when it's at zero percent.
}

type BAF = BigAssFans_i6PlatformAccessory;

interface Capabilities {
  hasTempSensor: boolean;
  hasHumiditySensor: boolean;
  hasOccupancySensor: boolean;
  hasLight: boolean;
  hasLightSensor: boolean;
  hasColorTempControl: boolean;
  hasFan: boolean;
  hasSpeaker: boolean;
  hasPiezo: boolean;
  hasLEDIndicators: boolean;
  hasUplight: boolean;
  hasUVCLight: boolean;
  hasStandbyLed: boolean;
  hasEcoMode : boolean;
}

export class BigAssFans_i6PlatformAccessory {
  public capabilitiesEstablished = false;
  public capabilities: Capabilities = {
    hasTempSensor: false,
    hasHumiditySensor: false,
    hasOccupancySensor: false,
    hasLight: false,
    hasLightSensor: false,
    hasColorTempControl: false,
    hasFan: false,
    hasSpeaker: false,
    hasPiezo: false,
    hasLEDIndicators: false,
    hasUplight: false,
    hasUVCLight: false,
    hasStandbyLed: false,
    hasEcoMode: false,
  };

  public fanService!: Service;
  public downlightBulbService!: Service;
  public uplightBulbService!: Service;
  public humiditySensorService!: Service;
  public temperatureSensorService!: Service;
  public whooshSwitchService!: Service;
  public dimToWarmSwitchService!: Service;
  public fanAutoSwitchService!: Service;
  public lightAutoSwitchService!: Service;
  public ecoModeSwitchService!: Service;
  public UVCSwitchService!: Service;
  public fanOccupancySensorService!: Service;
  public lightOccupancySensorService!: Service;

  public downlightStates: lightStates = {
    On: false,
    Brightness: 1,  // percent
    ColorTemperature: 2200,
    homeShieldUp: false,  // used to prevent Home.app from turning light on at 100% when it's at zero percent.
  };

  public uplightStates: lightStates  = {
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

  public fanOccupancyDetected = false;
  public lightOccupancyDetected = false;

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
  public UVCSwitchOn = false;
  public disableDirectionControl = false;
  public noLights = false;
  public showFanOccupancySensor = false;
  public showLightOccupancySensor = false;

  public downlightEquipped = undefined;
  public uplightEquipped = undefined;

  public enableDebugPort = false;
  public simulated = false; // for future use

  public showHumidity = true;
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

  public uptimeMinutes = 0;
  public rebootCount = 0;
  public rebootReason = 0;

  public debugLevel = 1;
  public debugLevels:number[] = [];

  public CurrentTemperature = 0;
  public CurrentRelativeHumidity = 0;

  public bulbCount = 0;
  public targetBulb = 0;
  public fanOnMeansAuto = undefined;
  public lightOnMeansAuto = undefined;

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
    this.debugLevels['capabilities']      = 0;
    this.debugLevels['characteristics']   = 0;
    this.debugLevels['cluing']            = 0; // 6;
    this.debugLevels['direction']         = 0; // 1
    this.debugLevels['funstack']          = 0;
    this.debugLevels['humidity']          = 0;
    this.debugLevels['light']             = 0; // 2;
    this.debugLevels['manufacturerDebug'] = 0;
    this.debugLevels['network']           = 0;
    this.debugLevels['newcode']           = 0;
    this.debugLevels['noopcodes']         = 0;
    this.debugLevels['occupancy']         = 0;
    this.debugLevels['progress']          = 0;
    this.debugLevels['protoparse']        = 0; // 2
    this.debugLevels['reconnect']         = 0;
    this.debugLevels['redflags']          = 0; // 1;

    if (this.accessory.context.device.debugLevels !== undefined) {
      for (const debugEntry of this.accessory.context.device.debugLevels) {
        const entry:(string | number)[] = debugEntry as (string | number)[];
        this.debugLevels[entry[0]] = entry[1];
      }
    }

    if (accessory.context.device.noLights) {
      this.noLights = true;  // defaults to false in property initialization
    }

    if (accessory.context.device.downlightEquipped !== undefined) {
      this.downlightEquipped = accessory.context.device.downlightEquipped;
    }
    if (accessory.context.device.uplightEquipped !== undefined) {
      this.uplightEquipped = accessory.context.device.uplightEquipped;
    }

    if (accessory.context.device.whoosh) {
      hbLog.warn(`${this.Name} - use of "whoosh" configuration attribute is deprecated, please use "showWhooshSwitch" instead`);
      this.showWhooshSwitch = true;
    }
    if (accessory.context.device.showWhooshSwitch) {
      this.showWhooshSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.dimToWarm) {
      hbLog.warn(`${this.Name} - use of "dimToWarm" configuration attribute is deprecated, please use "showDimToWarmSwitch" instead`);
      this.showDimToWarmSwitch = true;
    }
    if (accessory.context.device.showDimToWarmSwitch) {
      this.showDimToWarmSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.fanAuto) {
      hbLog.warn(`${this.Name} - use of "fanAuto" configuration attribute is deprecated, please use "showFanAutoSwitch" instead`);
      this.showFanAutoSwitch = true;
    }
    if (accessory.context.device.showFanAutoSwitch) {
      this.showFanAutoSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.lightAuto) {
      hbLog.warn(`${this.Name} - use of "lightAuto" configuration attribute is deprecated, please use "showLightAutoSwitch" instead`);
      this.showLightAutoSwitch = true;
    }
    if (accessory.context.device.showLightAutoSwitch) {
      this.showLightAutoSwitch = true; // defaults to false in property initialization
    }

    if (accessory.context.device.ecoMode) {
      hbLog.warn(`${this.Name} - use of "ecoMode" configuration attribute is deprecated, please use "showEcoModeSwitch" instead`);
      this.showEcoModeSwitch = true;
    }
    if (accessory.context.device.showEcoModeSwitch) {
      this.showEcoModeSwitch = true;  // defaults to false in property initialization
    }

    if (accessory.context.device.probeFrequency !== undefined) {
      this.ProbeFrequency = accessory.context.device.probeFrequency;
      debugLog(this, 'progress',  1, 'set ProbeFrequency to: ' + this.ProbeFrequency);
    } else {
      debugLog(this, 'progress',  1, 'ProbeFrequency is set to: ' + this.ProbeFrequency);
    }

    if (accessory.context.device.disableDirectionControl) {
      this.disableDirectionControl = true;
    }

    if (accessory.context.device.showFanOccupancySensor) {
      this.showFanOccupancySensor = true;
    }

    if (accessory.context.device.showLightOccupancySensor) {
      this.showLightOccupancySensor = true;
    }

    if (accessory.context.device.enableDebugPort) {
      this.enableDebugPort = true;
    }

    /**
    * set accessory information
    */

    // I've forgotten the point of specifying a model name in the config file (unless it's devModelOverride) but
    // am not ready to delete this code yet.
    if (this.accessory.context.device.fanModel !== undefined && this.accessory.context.device.fanModel !== 'other') {
      this.Model = this.accessory.context.device.fanModel;
    }

    /**
    * open the fan's communication port, establish the data and error callbacks, send the initialization sequence and send a probe
    */
    networkSetup(this);
    debugLog(this, 'progress', 2, 'constructed');
  }

  async setDownLightOnState(value: CharacteristicValue) {
    debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Downlight On -> ' + value);

    if (this.bulbCount === 2) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x90, 0x05, TARGETLIGHT_DOWN, 0xc0])), this);
    }

    if (this.downlightStates.On && (value as boolean)) {
      debugLog(this, 'light', 1, 'setDownLightOnState: redundant, ignore this');
    } else {
      this.downlightStates.On = value as boolean;
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, (this.downlightStates.On ? 0x01 : 0x00), 0xc0])), this);
    }
  }

  async getDownLightOnState(): Promise<CharacteristicValue> {
    const isOn = this.downlightStates.On;
    debugLog(this, ['light', 'characteristics'], [2, 4], 'Get Characteristic Down Light On -> ' + isOn);
    // if you need to return an error to show the device as 'Not Responding' in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return isOn;
  }

  async setDownBrightness(value: CharacteristicValue) {
    let b: Buffer;

    if (this.bulbCount === 2) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x90, 0x05, TARGETLIGHT_DOWN, 0xc0])), this);
    }

    if (value === 0) {
      debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Down Brightness -> ' + value);
      this.downlightStates.homeShieldUp = true;
      this.downlightStates.Brightness = 0;
      const b1 = ONEBYTEHEADER.concat([0xa8, 0x04, 1, 0xc0]); // this one is for the device's memory
      const b2 = ONEBYTEHEADER.concat([0xa8, 0x04, 0, 0xc0]); // this one is actually turn off light
      b = Buffer.from(b1.concat(b2));
    } else if (value === 100 && this.downlightStates.homeShieldUp) {
      this.downlightStates.homeShieldUp = false;
      this.downlightStates.Brightness = 1;
      b = Buffer.from(ONEBYTEHEADER.concat([0xa8, 0x04, 1, 0xc0]));
    } else {
      this.downlightStates.homeShieldUp = false;
      debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Down Brightness -> ' + value);
      this.downlightStates.Brightness = value as number;
      b = Buffer.from(ONEBYTEHEADER.concat([0xa8, 0x04, this.downlightStates.Brightness, 0xc0]));
    }
    clientWrite(this.client, b, this);
  }

  async getDownBrightness(): Promise<CharacteristicValue> {
    const brightness = (this.downlightStates.Brightness === 0 ? 1 : this.downlightStates.Brightness);
    debugLog(this, ['light', 'characteristics'], [2, 4], 'Get Characteristic Down Brightness -> ' + brightness);
    return brightness;
  }

  async setUpLightOnState(value: CharacteristicValue) {
    debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Up Light On -> ' + value);

    if (this.bulbCount === 2) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x90, 0x05, TARGETLIGHT_UP, 0xc0])), this);
    } else if (this.Model === 'es6')  { // es6 with one light - temporary(!?) hack to debug issue #20
      // don't know if this issue is limited to the es6 but the network/11 dumps from issue #20 show the MultipleLightMode property
      //  has a value of "1" which means "Downlight".  But the fan in question only has an uplight.  But apparently it thinks it's a
      //  downlight, so we'll go with that.
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x90, 0x05, this.targetBulb, 0xc0])), this);
    }

    if (this.uplightStates.On && (value as boolean)) {
      debugLog(this, 'light', 1, 'setUpLightOnState: redundant, ignore this');
    } else {
      this.uplightStates.On = value as boolean;
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, (this.uplightStates.On ? 0x01 : 0x00), 0xc0])), this);
    }
  }

  async getUpLightOnState(): Promise<CharacteristicValue> {
    const isOn = this.uplightStates.On;
    debugLog(this, ['light', 'characteristics'], [2, 4], 'Get Characteristic Up Light On -> ' + isOn);
    return isOn;
  }

  async setUpBrightness(value: CharacteristicValue) {
    let b: Buffer;

    if (this.bulbCount === 2) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x90, 0x05, TARGETLIGHT_UP, 0xc0])), this);
    }
    if (this.Model === 'es6')  { // temporary(!?) hack to debug issue #20, see setUpLightOnState()
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x90, 0x05, this.targetBulb, 0xc0])), this);
    }

    if (value === 0) {
      debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Up Brightness -> ' + value);
      this.uplightStates.homeShieldUp = true;
      this.uplightStates.Brightness = 0;
      const b1 = ONEBYTEHEADER.concat([0xa8, 0x04, 1, 0xc0]); // this one is for the device's memory
      const b2 = ONEBYTEHEADER.concat([0xa8, 0x04, 0, 0xc0]); // this one is actually turn off light
      b = Buffer.from(b1.concat(b2));
    } else if (value === 100 && this.uplightStates.homeShieldUp) {
      this.uplightStates.homeShieldUp = false;
      this.uplightStates.Brightness = 1;
      b = Buffer.from(ONEBYTEHEADER.concat([0xa8, 0x04, 1, 0xc0]));
    } else {
      this.uplightStates.homeShieldUp = false;
      debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Up Brightness -> ' + value);
      this.uplightStates.Brightness = value as number;
      b = Buffer.from(ONEBYTEHEADER.concat([0xa8, 0x04, this.uplightStates.Brightness, 0xc0]));
    }
    clientWrite(this.client, b, this);
  }

  async getUpBrightness(): Promise<CharacteristicValue> {
    const brightness = (this.uplightStates.Brightness === 0 ? 1 : this.uplightStates.Brightness);
    debugLog(this, ['light', 'characteristics'], [2, 4], 'Get Characteristic Up Brightness -> ' + brightness);
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
  async setDownColorTemperature(value: CharacteristicValue) {
    if (this.bulbCount === 2) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0x90, 0x05, TARGETLIGHT_DOWN, 0xc0])), this);
    }
    // should maybe limit color temp to one of 5 BAF supported values - 2200, 2700, 4000, 5000, 6500?
    this.downlightStates.ColorTemperature = Math.round(1000000/(value as number));
    debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Down ColorTemperature  -> ' + value +
        ' (' + this.downlightStates.ColorTemperature + ')');
    const stuffedVarInt = stuff(varint_encode(this.downlightStates.ColorTemperature));
    const firstPart = [0xc0, 0x12, stuffedVarInt.length + 6, 0x12, stuffedVarInt.length + 4, 0x1a, stuffedVarInt.length + 2, 0xb8, 0x04];
    clientWrite(this.client, Buffer.from(firstPart.concat(stuffedVarInt, 0xc0)), this);
  }

  async getDownColorTemperature(): Promise<CharacteristicValue> {
    const colorTemperature = Math.round(1000000 / this.downlightStates.ColorTemperature);
    debugLog(this, ['light', 'characteristics'], [1, 4], 'Get Characteristic Down ColorTemperature -> ' + colorTemperature +
        ' (' + this.downlightStates.ColorTemperature + ')');
    return colorTemperature;
  }

  // async setUpColorTemperature(value: CharacteristicValue) {
  //   // should maybe limit color temp to one of 5 BAF supported values - 2200, 2700, 4000, 5000, 6500?
  //   this.uplightStates.ColorTemperature = Math.round(1000000/(value as number));
  //   debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Up ColorTemperature  -> ' + value +
  //       ' (' + this.uplightStates.ColorTemperature + ')');
  //   const stuffedVarInt = stuff(varint_encode(this.uplightStates.ColorTemperature));
  //   const firstPart = [0xc0, 0x12, stuffedVarInt.length + 6, 0x12, stuffedVarInt.length + 4, 0x1a, stuffedVarInt.length + 2, 0xb8, 0x04];
  //   clientWrite(this.client, Buffer.from(firstPart.concat(stuffedVarInt, 0xc0)), this);
  // }

  // async getUpColorTemperature(): Promise<CharacteristicValue> {
  //   const colorTemperature = Math.round(1000000 / this.uplightStates.ColorTemperature);
  //   debugLog(this, ['light', 'characteristics'], [1, 4], 'Get Characteristic Up ColorTemperature -> ' + colorTemperature +
  //       ' (' + this.uplightStates.ColorTemperature + ')');
  //   return colorTemperature;
  // }

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

  // set/get won't be called unless showDimToWarmSwitch is true
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

  // set/get won't be called unless showFanAutoSwitch is true
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

  // set/get won't be called unless showLightAutoSwitch is true
  async setLightAutoSwitchOnState(value: CharacteristicValue) {
    debugLog(this, ['light', 'characteristics'], [1, 3], 'Set Characteristic Light Auto Switch On -> ' + value);
    this.lightAutoSwitchOn = value as boolean;

    if (this.lightAutoSwitchOn) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, 0x02, 0xc0])), this);
    } else {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, (this.downlightStates.On ? 0x01 : 0x00), 0xc0])), this);
    }
  }

  async getLightAutoSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.lightAutoSwitchOn;
    debugLog(this, 'characteristics', 3, 'Get Characteristic Light Auto Switch On -> ' + isOn);
    return isOn;
  }

  // set/get won't be called unless showEcoModeSwitch is true
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

  async handleFanOccupancyDetectedGet(): Promise<CharacteristicValue> {
    const occupancy = this.fanOccupancyDetected;
    debugLog(this, 'characteristics', 3, 'Get Characteristic Fan Occupancy Detected -> ' + occupancy);
    return occupancy;
  }

  async handleLightOccupancyDetectedGet(): Promise<CharacteristicValue> {
    const occupancy = this.lightOccupancyDetected;
    debugLog(this, 'characteristics', 3, 'Get Characteristic Light Occupancy Detected -> ' + occupancy);
    return occupancy;
  }

  // set/get won't be called unless UV-C is detected
  async setUVCSwitchOnState(value: CharacteristicValue) {
    debugLog(this, 'characteristics', 3, 'Set Characteristic UVC Switch On -> ' + value);
    this.UVCSwitchOn = value as boolean;
    clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xe0, 0x0a, (this.UVCSwitchOn ? 0x01 : 0x0), 0xc0])), this);
  }

  async getUVCSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.UVCSwitchOn;
    debugLog(this, 'characteristics', 3, 'Get Characteristic UVC Switch On -> ' + isOn);
    return isOn;
  }
}

function makeServices(pA: BAF) {
  const capitalizeName = pA.Name[0] === pA.Name[0].toUpperCase();
  let accessoryName:string;

  pA.accessory.getService(pA.platform.Service.AccessoryInformation)!
    .setCharacteristic(pA.platform.Characteristic.Manufacturer, 'Big Ass Fans')
    .setCharacteristic(pA.platform.Characteristic.SerialNumber, pA.MAC);

  // fan
  if (pA.capabilities.hasFan) {
    pA.fanService = pA.accessory.getService(pA.platform.Service.Fan) ||
      pA.accessory.addService(pA.platform.Service.Fan);
    // pA.fanService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name);
    setName(pA, pA.fanService, pA.Name);

    pA.fanService.getCharacteristic(pA.platform.Characteristic.On)
      .onSet(pA.setFanOnState.bind(pA))
      .onGet(pA.getFanOnState.bind(pA));

    pA.fanService.getCharacteristic(pA.platform.Characteristic.RotationSpeed)
      .onSet(pA.setRotationSpeed.bind(pA))
      .onGet(pA.getRotationSpeed.bind(pA));

    if (pA.disableDirectionControl) {
      // Am commenting out pA 'removeCharacteristic' line because it doesn't remove the control anyway.
      // It's just as well since fanRotationDirection() lets the user know if the direction changes via remote or BAF app.
      // pA.fanService.removeCharacteristic(pA.fanService.getCharacteristic(pA.platform.Characteristic.RotationDirection));
    } else {
      pA.fanService.getCharacteristic(pA.platform.Characteristic.RotationDirection)
        .onSet(pA.setRotationDirection.bind(pA))
        .onGet(pA.getRotationDirection.bind(pA));
    }

    if (pA.showWhooshSwitch) {
      pA.whooshSwitchService = pA.accessory.getService('whooshSwitch') ||
        pA.accessory.addService(pA.platform.Service.Switch, 'whooshSwitch', 'switch-1');
      accessoryName = capitalizeName ?  ' Whoosh' : ' whoosh';
      // pA.whooshSwitchService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name + accessoryName);
      setName(pA, pA.whooshSwitchService, pA.Name + accessoryName);

      pA.whooshSwitchService.getCharacteristic(pA.platform.Characteristic.On)
        .onSet(pA.setWhooshSwitchOnState.bind(pA))
        .onGet(pA.getWhooshSwitchOnState.bind(pA));
    } else {
      const service = pA.accessory.getService('whooshSwitch');
      if (service) {
        pA.accessory.removeService(service);
      }
    }
    if (pA.showDimToWarmSwitch) {
      pA.dimToWarmSwitchService = pA.accessory.getService('dimToWarmSwitch') ||
        pA.accessory.addService(pA.platform.Service.Switch, 'dimToWarmSwitch', 'switch-2');
      accessoryName = capitalizeName ?  ' Dim to Warm' : ' dim to warm';
      // pA.dimToWarmSwitchService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name + accessoryName);
      setName(pA, pA.dimToWarmSwitchService, pA.Name + accessoryName);

      pA.dimToWarmSwitchService.getCharacteristic(pA.platform.Characteristic.On)
        .onSet(pA.setDimToWarmSwitchOnState.bind(pA))
        .onGet(pA.getDimToWarmSwitchOnState.bind(pA));
    } else {
      const service = pA.accessory.getService('dimToWarmSwitch');
      if (service) {
        pA.accessory.removeService(service);
      }
    }
    if (pA.showFanAutoSwitch) {
      pA.fanAutoSwitchService = pA.accessory.getService('fanAutoSwitch') ||
        pA.accessory.addService(pA.platform.Service.Switch, 'fanAutoSwitch', 'switch-3');
      accessoryName = capitalizeName ?  ' Fan Auto' : ' fan auto';
      // pA.fanAutoSwitchService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name + accessoryName);
      setName(pA, pA.fanAutoSwitchService, pA.Name + accessoryName);

      pA.fanAutoSwitchService.getCharacteristic(pA.platform.Characteristic.On)
        .onSet(pA.setFanAutoSwitchOnState.bind(pA))
        .onGet(pA.getFanAutoSwitchOnState.bind(pA));
    } else {
      const service = pA.accessory.getService('fanAutoSwitch');
      if (service) {
        pA.accessory.removeService(service);
      }
    }
  }

  if (pA.capabilities.hasOccupancySensor) {
    if (pA.showFanOccupancySensor) {
      pA.fanOccupancySensorService = pA.accessory.getService('fanOccupancySensor') ||
        pA.accessory.addService(pA.platform.Service.OccupancySensor, 'fanOccupancySensor', 'occupancySensor-1');
      accessoryName = capitalizeName ?  ' Occupancy' : ' fan occupancy';
      setName(pA, pA.fanOccupancySensorService, pA.Name + accessoryName);

      pA.fanOccupancySensorService.getCharacteristic(pA.platform.Characteristic.OccupancyDetected)
        .onGet(pA.handleFanOccupancyDetectedGet.bind(pA));
    } else {
      const service = pA.accessory.getService('fanOccupancySensor');
      if (service) {
        pA.accessory.removeService(service);
      }
    }
    if (pA.showLightOccupancySensor) {
      pA.lightOccupancySensorService = pA.accessory.getService('lightOccupancySensor') ||
        pA.accessory.addService(pA.platform.Service.OccupancySensor, 'lightOccupancySensor', 'occupancySensor-2');
      accessoryName = capitalizeName ?  ' Light Occupancy' : ' light occupancy';
      setName(pA, pA.lightOccupancySensorService, pA.Name + accessoryName);

      pA.lightOccupancySensorService.getCharacteristic(pA.platform.Characteristic.OccupancyDetected)
        .onGet(pA.handleLightOccupancyDetectedGet.bind(pA));
    } else {
      const service = pA.accessory.getService('lightOccupancySensor');
      if (service) {
        pA.accessory.removeService(service);
      }
    }
  } else {
    if (pA.showFanOccupancySensor) {
      hbLog.info('\'"showFanOccupancySensor": true\' in config.json but this fan does not have an Occupancy Sensor');
    }
    if (pA.showLightOccupancySensor) {
      hbLog.info('\'"showLightOccupancySensor": true\' in config.json but this fan does not have an Occupancy Sensor');
    }
  }

  // downlight
  if (pA.capabilities.hasLight) {
    if (pA.noLights) {
      hbLog.info(`${pA.Name} downlight disabled by configuration '"noLights": true'`);
      const service = pA.accessory.getService('downlight');
      if (service) {
        pA.accessory.removeService(service);
      }
    } else {
      pA.downlightBulbService = pA.accessory.getService(pA.platform.Service.Lightbulb) ||
        pA.accessory.getService('downlight') ||
        pA.accessory.addService(pA.platform.Service.Lightbulb, 'downlight', 'light-1');
      setName(pA, pA.downlightBulbService, pA.Name + capitalizeName ? ' Light' : ' light');

      pA.downlightBulbService.getCharacteristic(pA.platform.Characteristic.On)
        .onSet(pA.setDownLightOnState.bind(pA))
        .onGet(pA.getDownLightOnState.bind(pA));

      pA.downlightBulbService.getCharacteristic(pA.platform.Characteristic.Brightness)
        .onSet(pA.setDownBrightness.bind(pA))
        .onGet(pA.getDownBrightness.bind(pA));

      if (pA.capabilities.hasColorTempControl) {
        pA.downlightBulbService.getCharacteristic(pA.platform.Characteristic.ColorTemperature)
          .onSet(pA.setDownColorTemperature.bind(pA))
          .onGet(pA.getDownColorTemperature.bind(pA));
      }

      pA.bulbCount++;
    }
  }

  // uplight
  if (pA.capabilities.hasUplight) {
    if (pA.noLights) {
      hbLog.info(`${pA.Name} uplight disabled by configuration '"noLights": true'`);
      const service = pA.accessory.getService('uplight');
      if (service) {
        pA.accessory.removeService(service);
      }
    } else {
      pA.uplightBulbService = pA.accessory.getService('uplight') ||
        pA.accessory.addService(pA.platform.Service.Lightbulb, 'uplight', 'light-2');
      setName(pA, pA.uplightBulbService, pA.Name + (capitalizeName ? ' Uplight' : ' uplight'));

      pA.uplightBulbService.getCharacteristic(pA.platform.Characteristic.On)
        .onSet(pA.setUpLightOnState.bind(pA))
        .onGet(pA.getUpLightOnState.bind(pA));

      pA.uplightBulbService.getCharacteristic(pA.platform.Characteristic.Brightness)
        .onSet(pA.setUpBrightness.bind(pA))
        .onGet(pA.getUpBrightness.bind(pA));

      // pA.uplightBulbService.getCharacteristic(pA.platform.Characteristic.ColorTemperature)
      // .onSet(pA.setUpColorTemperature.bind(pA))
      // .onGet(pA.getUpColorTemperature.bind(pA));

      pA.bulbCount++;
    }
  }


  if (pA.capabilities.hasUVCLight) {
    if (pA.noLights) {
      hbLog.info(`${pA.Name} UVC light disabled by configuration '"noLights": true'`);
    } else {
      if (pA.UVCSwitchService === undefined) {
        pA.UVCSwitchService = pA.accessory.getService('UVCSwitch') ||
          pA.accessory.addService(pA.platform.Service.Switch, 'UVCSwitch', 'switch-6');
        setName(pA, pA.UVCSwitchService, pA.Name + ' UVC');

        pA.UVCSwitchService.getCharacteristic(pA.platform.Characteristic.On)
          .onSet(pA.setUVCSwitchOnState.bind(pA))
          .onGet(pA.getUVCSwitchOnState.bind(pA));
      }
    }
  }

  // Current Temperature
  if (pA.capabilities.hasTempSensor) {
    if (pA.showTemperature === undefined || pA.showTemperature !== false) {
      pA.temperatureSensorService = pA.accessory.getService(pA.platform.Service.TemperatureSensor) ||
        pA.accessory.addService(pA.platform.Service.TemperatureSensor);
      accessoryName = capitalizeName ?  ' Temperature' : ' temperature';
      // pA.temperatureSensorService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name + accessoryName);
      setName(pA, pA.temperatureSensorService, pA.Name + accessoryName);
      pA.temperatureSensorService.getCharacteristic(pA.platform.Characteristic.CurrentTemperature)
        .onGet(pA.getCurrentTemperature.bind(pA));
    } else {
      const service = pA.accessory.getService(pA.platform.Service.TemperatureSensor);
      if (service) {
        pA.accessory.removeService(service);
      }
    }
  }

  // Current Relative Humidity
  if (pA.capabilities.hasHumiditySensor) {
    if (pA.showHumidity === undefined || pA.showHumidity !== false) {
      pA.humiditySensorService = pA.accessory.getService(pA.platform.Service.HumiditySensor) ||
        pA.accessory.addService(pA.platform.Service.HumiditySensor);
      accessoryName = capitalizeName ?  ' Humidity' : ' humidity';
      // pA.humiditySensorService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name + accessoryName);
      setName(pA, pA.humiditySensorService, pA.Name + accessoryName);

      pA.humiditySensorService.getCharacteristic(pA.platform.Characteristic.CurrentRelativeHumidity)
        .onGet(pA.getCurrentRelativeHumidity.bind(pA));
    } else {
      const service = pA.accessory.getService(pA.platform.Service.HumiditySensor);
      if (service) {
        pA.accessory.removeService(service);
      }
    }
  }

  if (pA.showLightAutoSwitch) {
    pA.lightAutoSwitchService = pA.accessory.getService('lightAutoSwitch') ||
      pA.accessory.addService(pA.platform.Service.Switch, 'lightAutoSwitch', 'switch-4');
    accessoryName = capitalizeName ?  ' Light Auto' : ' light auto';
    // pA.lightAutoSwitchService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name + accessoryName);
    setName(pA, pA.lightAutoSwitchService, pA.Name + accessoryName);

    pA.lightAutoSwitchService.getCharacteristic(pA.platform.Characteristic.On)
      .onSet(pA.setLightAutoSwitchOnState.bind(pA))
      .onGet(pA.getLightAutoSwitchOnState.bind(pA));
  } else {
    const service = pA.accessory.getService('lightAutoSwitch');
    if (service) {
      debugLog(pA, 'light', 1, 'removeService: lightAutoSwitch');
      pA.accessory.removeService(service);
    }
  }

  if (pA.showEcoModeSwitch) {
    if (pA.capabilities.hasEcoMode) {
      pA.ecoModeSwitchService = pA.accessory.getService('ecoModeSwitch') ||
        pA.accessory.addService(pA.platform.Service.Switch, 'ecoModeSwitch', 'switch-5');
      accessoryName = capitalizeName ?  ' Eco Mode' : ' eco mode';
      // pA.ecoModeSwitchService.setCharacteristic(pA.platform.Characteristic.Name, pA.Name + accessoryName);
      setName(pA, pA.ecoModeSwitchService, pA.Name + accessoryName);

      pA.ecoModeSwitchService.getCharacteristic(pA.platform.Characteristic.On)
        .onSet(pA.setEcoModeSwitchOnState.bind(pA))
        .onGet(pA.getEcoModeSwitchOnState.bind(pA));
    } else {
      hbLog.info('\'"showEcoModeSwitch": true\' in config.json but this fan does not support Eco Mode');
    }
  } else {
    const service = pA.accessory.getService('ecoModeSwitch');
    if (service) {
      pA.accessory.removeService(service);
    }
  }

  debugLog(pA, 'progress', 1, 'leaving makeServices');
}

/**
* connect to the fan, send capability query and initialization message,
* establish the error and data callbacks and start a keep-alive interval timer.
*/
import net = require('net');

function networkSetup(pA: BAF) {

  if (pA.ProbeFrequency !== 0) {
    // attempt to prevent the occassional socket reset.
    // sending the mysterious code that the vendor app seems to send once every 15s but instead sending every minute - didn't prevent it.
    // sending every 15 seconds didn't help.
    // calling socket.setKeepAlive([enable][, initialDelay]) when I establish it above didn't help.
    // obviously, I don't understand this stuff.
    // once I got an EPIPE 5+ hours after a reset, and repeaated EPIPEs every minute for the next 7 minutes, then one more after 4 minutes
    // then clear sailing for 1+ hours so far.
    pA.probeTimeout = setInterval(( )=> {
      if (pA.client !== undefined) {
        clientWrite(pA.client, Buffer.from([0xc0, 0x12, 0x04, 0x1a, 0x02, 0x08, 0x03, 0xc0]), pA); // parroting the BAF app
      } else {
        debugLog(pA, 'network', 4, 'client undefined in setInterval callback');
      }
    }, pA.ProbeFrequency);
  }

  const connectOptions = {port: 31415, host: pA.IP, family: 4};
  pA.client = net.connect(connectOptions, () => {
    debugLog(pA, ['network', 'progress'], [1, 2], 'connected!');
    pA.client.setKeepAlive(true);
    clientWrite(pA.client, Buffer.from([0xc0, 0x12, 0x04, 0x1a, 0x02, 0x08, 0x06, 0xc0]), pA);  // get capabilities
    clientWrite(pA.client, Buffer.from([0xc0, 0x12, 0x02, 0x1a, 0x00, 0xc0]), pA);  // BAF app seemed to send this so we will also
  });

  let errHandler;
  let retryCount = 0;
  let retrySeconds = 0;

  pA.client.on('error', errHandler = (err) => {
    debugLog(pA, 'reconnect', 1, `"${err.message}"`);

    retrySeconds = backOff(err.code, retryCount);
    switch (err.code) {
      case 'ECONNREFUSED':
        hbLog.error(`${pA.Name} (${pA.IP}) connection refused ${err.code}.  Check that the correct IP is in json.config.`);
        // why clearInterval here but not in the other case that returns
        if (pA.probeTimeout !== undefined) {
          clearInterval(pA.probeTimeout);
        }
        return;
      case 'ENETUNREACH':
        hbLog.error(pA.Name + ' (' + pA.IP + ')' + ` is unreachable [${err.code}].  Check the correct IP is in json.config.`);
        return;

      case 'ETIMEDOUT':
        hbLog.error(`${pA.Name} (${pA.IP}) connection timed out [${err.code}].\n` +
          `Check your fan has power and the correct IP in json.config. Will retry in ${retrySeconds} seconds.`);
        break;
      case 'EHOSTDOWN': {
        const minutes = Math.round(retrySeconds / 60);
        hbLog.error(pA.Name + ' (' + pA.IP + ')' + ` connection problem [${err.code}].` +
          `Attempting reconnect in ${minutes} ${minutes === 1 ? 'minute.' : 'minutes.'}`);
        break;
      }
      case 'ECONNRESET':
        // noticed 7/17/2023 there is an ECONNRESET every two hours.  But not always.
        debugLog(pA, 'reconnect', 1,
          `${pA.Name} (${pA.IP}) network connection reset [${err.code}].  Attempting reconnect in ${retrySeconds} seconds.`);
        debugLog(pA, 'reconnect', 1, `uptime: ${toDaysHoursMinutesString(pA.uptimeMinutes)}`);
        break;
      case 'EPIPE':
        hbLog.warn(`${pA.Name} (${pA.IP}) network connection broke [${err.code}].  Attempting reconnect in ${retrySeconds} seconds.`);
        break;
      case 'ENOTFOUND':
        hbLog.warn(`${pA.Name} (${pA.IP}) network connection broke [${err.code}].  Attempting reconnect in ${retrySeconds} seconds.`);
        break;

      default:
        hbLog.warn(`${pA.Name} (${pA.IP}) Unhandled network error: [${err.code}].  Attempting reconnect in ${retrySeconds} seconds.`);
        break;
    }

    retryCount++;
    pA.client = undefined;
    // debugLog(pA, 'reconnect', 1, `will reconnect in ${retrySeconds} seconds.`);
    setTimeout(() => {
      // already did this one or more times, don't need to send initilization message
      // debugLog(pA, 'reconnect', 1, 'attempting reconnect...');
      pA.client = net.connect(connectOptions, () => {
        retryCount = 0;
        if (err.code !== 'ECONNRESET') { // ECONNRESETs seem pretty normal and regular
          hbLog.info(pA.Name + ' reconnected!');
        }
        debugLog(pA, ['network', 'reconnect'], [1, 1], `reconnected after [${err.code}]`);
      });
      pA.client.on('error', (err) => {
        errHandler(err);
      });
      pA.client.on('data', (data) => {
        onData(pA, data);
      });
    }, retrySeconds * 1000);
  });

  pA.client.on('data', (data: Buffer) => {
    onData(pA, data);
  });

  // listen for debugLevel changes
  if (pA.enableDebugPort) {
    const srv = net.createServer((c) => {
      hbLog.info(`${pA.Name} - debug client connected`);
      c.on('end', () => {
        hbLog.info(`${pA.Name} - debug client disconnected`);
      });
      c.write(`${pA.Name}\n`);

      c.on('data', (data: Buffer) => {
        let s = data.toString('utf8');
        if (s === '\n') {
          for (const key in pA.debugLevels) {
            c.write(`  ${key}, ${pA.debugLevels[key]}\n`);
          }
        } else {
          s = s.replace('\n', '');

          if (s === '?') {
            c.write('p uptime or <debug key> <debug level> [enter new line for list]\n');
          } else if (s.startsWith('p')) {
            switch (s) {
              case 'p uptime':
                c.write(`uptime: ${toDaysHoursMinutesString(pA.uptimeMinutes)}\n`);
                break;
              default:
                break;
            }
          } else if (s === 'ECONNRESET') {
            pA.client.destroy(new Error('ECONNRESET'));
          } else {
            const a = s.split(', ');

            if ((typeof pA.debugLevels[a[0]]) === 'number') {
              pA.debugLevels[a[0]] = Number(a[1]);
              c.write(`${a[0]} set to ${Number(a[1])}\n`);
            } else {
              c.write(`"${a[0]}" is not valid\n`);
            }
          }
        }
      });
    });

    srv.listen(0, () => {
      const info = srv.address() as net.AddressInfo;
      hbLog.info(`${pA.Name} - plugin listening for debugging commands on port: ${info.port}`);
    });
  }
}

const timedOutBackOff = [5, 5, 5, 600, 1800, 3600, 21600, 432000, 86400];
function backOff(errorMsgString: string, retryCount: number) : number {
  switch (errorMsgString) {
    case 'ETIMEDOUT':
      if (retryCount >= timedOutBackOff.length) {
        return timedOutBackOff[timedOutBackOff.length - 1];
      } else {
        return timedOutBackOff[retryCount];
      }
    case 'EHOSTDOWN':
      return 60 * (1 + retryCount);

    case 'ENOTFOUND':
    case 'ECONNRESET':
      if (retryCount <= 5) {
        return 2;
      } else if (retryCount <= 24) {
        return 60;
      } else {
        return 86400;
      }
    default:
      return 2;
  }
}

/**
*  separate the data into chunks as required and feed them, unstuffed, to preChunk (if needed) and doChunk() one at a time.
*/
function onData(pA: BAF, data: Buffer) {
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

    const funStack: funCall[] = buildFunStack(unstuff(chunks[i]), pA);
    debugLog(pA, 'funstack', (funStack.length === 0) ? 2 : 1, `funstack.length: ${funStack.length}`);
    debugLog(pA, 'funstack', 1, `pA.capabilitiesEstablished: ${pA.capabilitiesEstablished}`);
    if (pA.capabilitiesEstablished) {
      funStack.forEach((value) => {
        debugLog(pA, 'funstack', 1, `  ${value[0].name}(${value[1]})`);
        value[0](value[1], pA);
      });
    }
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

// As of iOS/iPadOS 16, Home app uses ConfiguredName if present, else the generic accessory name (i.e. Light)
// https://discord.com/channels/432663330281226270/432672072859385856/1040394094528188416
// function setName(pA: BAF, service: Service, name: string) {
//   service.setCharacteristic(pA.platform.Characteristic.Name, name);

//   if (!service.testCharacteristic(pA.platform.Characteristic.ConfiguredName)) {
//     service.addCharacteristic(pA.platform.Characteristic.ConfiguredName);
//   }
//   service.setCharacteristic(pA.platform.Characteristic.ConfiguredName, name);
// }
function setName(pA: BAF, service: Service, name: string) {
  service.setCharacteristic(pA.platform.Characteristic.Name, name);

  if (!service.testCharacteristic(pA.platform.Characteristic.ConfiguredName)) {
    service.addCharacteristic(pA.platform.Characteristic.ConfiguredName);
    service.setCharacteristic(pA.platform.Characteristic.ConfiguredName, name);
  }
}

/**
* property handler functions
*/

function productType(value:string, pA:BAF) {
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
  }
}

function firmwareVersion(value:string, pA: BAF) {
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

function setTargetBulb(s: string, pA:BAF) {
  // if (pA.noLights) {
  //   return;
  // }

  // if (pA.Model === MODEL_HAIKU_L) { // Haiku L Series only can only have one light
  //   pA.targetBulb = TARGETLIGHT_DOWN;
  // } else {
  const value = Number(s);
  debugLog(pA, 'light', 1, 'setTargetBulb: ' + value);
  pA.targetBulb = value;
  // }
}

function lightColorTemperature(s: string, pA:BAF) {
  if (pA.noLights || !pA.capabilities.hasColorTempControl) {
    return;
  }

  const value = Number(s);
  switch (pA.targetBulb) {
    case TARGETLIGHT_UP:
      // targetedColorTemperature(value, pA.uplightBulbService, pA.uplightStates, 'Up', pA);
      break;
    case TARGETLIGHT_DOWN:
      targetedColorTemperature(value, pA.downlightBulbService, pA.downlightStates, 'Down', pA);
      break;
    case TARGETLIGHT_BOTH:
      // targetedColorTemperature(value, pA.uplightBulbService, pA.uplightStates, 'Up', pA);
      targetedColorTemperature(value, pA.downlightBulbService, pA.downlightStates, 'Down', pA);
      break;

    default:
      debugLog(pA, 'redflags', 1, `Unrecognized target bulb: ${pA.targetBulb}`);
  }
}
function targetedColorTemperature(value:number, service:Service, states:lightStates, description:string, pA:BAF) {
  if (service === undefined) {
    debugLog(pA, 'redflags', 1, `targetedColorTemperature: no ${description} lightbulb Service`);
    return;
  }
  states.ColorTemperature = value;
  const mireds = Math.round(1000000 / states.ColorTemperature);
  debugLog(pA, ['light', 'characteristics'], [1, 3], `update ${description} ColorTemperature: ${mireds} (${states.ColorTemperature})`);
  service.updateCharacteristic(pA.platform.Characteristic.ColorTemperature, mireds);
}

function lightBrightness(s: string, pA:BAF) {
  if (pA.noLights) {
    return;
  }

  const value = Number(s);
  switch (pA.targetBulb) {
    case TARGETLIGHT_UP:
      targetedlightBrightness(value, pA.uplightBulbService, pA.uplightStates, 'Up', pA);
      break;
    case TARGETLIGHT_DOWN:
      targetedlightBrightness(value, pA.downlightBulbService, pA.downlightStates, 'Down', pA);
      break;
    case TARGETLIGHT_BOTH:
      targetedlightBrightness(value, pA.uplightBulbService, pA.uplightStates, 'Up', pA);
      targetedlightBrightness(value, pA.downlightBulbService, pA.downlightStates, 'Down', pA);
      break;
  }
}
function targetedlightBrightness(value:number, lightBulbService:Service, states:lightStates, description:string, pA:BAF) {
  if (lightBulbService === undefined) {
    debugLog(pA, 'redflags', 1, `lightBrightness: no ${description} lightbulb Service`);
    return;
  }

  if (value !== 0) {
    states.homeShieldUp = false;
    states.Brightness = (value as number);
    debugLog(pA, ['light', 'characteristics'], [1, 3], `update ${description} Brightness: ` + states.Brightness);
    lightBulbService.updateCharacteristic(pA.platform.Characteristic.Brightness, states.Brightness);
    if (states.On === false) {
      states.On = true;
      debugLog(pA, ['light', 'characteristics'], [1, 3], `update ${description} Light On From targetedlightBrightness: ` + states.On);
      lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, states.On);
    }
  } else {
    if (states.On === true) {
      states.On = false;
      debugLog(pA, ['light', 'characteristics'], [1, 3], `update ${description} Light On From lightBrightness: ` + states.On);
      lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, states.On);
    }
  }
}

function lightOnState(s: string, pA:BAF) {
  if (pA.noLights) {
    return;
  }

  const value = Number(s);

  if (pA.bulbCount < 2) {
    if (pA.uplightBulbService !== undefined) {
      targetedlightOnState(value, pA.uplightBulbService, pA.uplightStates, 'Up', pA);
    } else if (pA.downlightBulbService !== undefined) {
      targetedlightOnState(value, pA.downlightBulbService, pA.downlightStates, 'Down', pA);
    } else {
      debugLog(pA, 'redflag', 1, `lightOnState() bulbCount: ${pA.bulbCount}, and no "up" or "down" bulbService`);
    }
  } else {
    switch (pA.targetBulb) {
      case TARGETLIGHT_UP:
        targetedlightOnState(value, pA.uplightBulbService, pA.uplightStates, 'Up', pA);
        break;
      case TARGETLIGHT_DOWN:
        targetedlightOnState(value, pA.downlightBulbService, pA.downlightStates, 'Down', pA);
        break;
      case TARGETLIGHT_BOTH:
        targetedlightOnState(value, pA.uplightBulbService, pA.uplightStates, 'Up', pA);
        targetedlightOnState(value, pA.downlightBulbService, pA.downlightStates, 'Down', pA);
        break;

      default:
        debugLog(pA, 'redflag', 1, `lightOnState() unknown targetBulb value: ${pA.targetBulb}`);
        break;
    }
  }
}
function targetedlightOnState(value:number, service:Service, states:lightStates, description:string, pA:BAF) {
  debugLog(pA, 'light', 1, `${description} lightOnState value: ` + value);

  if (service === undefined) {
    debugLog(pA, 'redflags', 1, `lightOnState: no ${description} lightbulb Service`);
    return;
  }

  if (value === 0 || value === 1) {
    const onValue = (value === 0 ? false : true);
    if (onValue !== states.On) {
      states.On = onValue;
      debugLog(pA, ['light', 'characteristics'], [1, 3], `update ${description} Light On: ` + states.On);
      service.updateCharacteristic(pA.platform.Characteristic.On, states.On);
    }

    if (pA.lightAutoSwitchOn) {
      pA.lightAutoSwitchOn = false;
      debugLog(pA, ['light', 'characteristics'], [1, 3], `update ${description} light auto switch off: ` + pA.lightAutoSwitchOn);
      pA.lightAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightAutoSwitchOn);
    }

  } else if (pA.showLightAutoSwitch && value === 2 && pA.lightAutoSwitchOn === false) {
    pA.lightAutoSwitchOn = true;
    debugLog(pA, ['light', 'characteristics'], [1, 3], `update ${description} light auto switch on: ` + pA.lightAutoSwitchOn);
    pA.lightAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightAutoSwitchOn);
  }
}

function fanOnState(s: string, pA:BAF) {
  const value = Number(s);
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

function fanRotationDirection(s: string, pA:BAF) {
  const value = Number(s);
  //  fan reports if 'reverse rotation' is on or off, homebridge wants rotation direction
  //  reverse switch off (0) == rotation direction counterclockwise (1)
  const rotationDirection = value === 0 ? 1 : 0;
  pA.fanStates.RotationDirection = rotationDirection;
  debugLog(pA, ['direction', 'characteristics'], [1, 3], 'update RotationDirection: ' + pA.fanStates.RotationDirection);
  pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationDirection, pA.fanStates.RotationDirection);
}

function fanRotationSpeed(s: string, pA:BAF) {
  const value = Number(s);
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

function currentTemperature(s: string, pA:BAF) {
  if (!pA.capabilities.hasTempSensor) {
    debugLog(pA, 'redflags', 1, 'warning: currentTemperature() called when pA.capabilities.hasTempSensor === false');
    return;
  }

  const value = Number(s);
  if (!pA.accessory.getService(pA.platform.Service.TemperatureSensor)) {
    debugLog(pA, 'redflags', 1, 'currentTemperature: no TemperatureSensor Service');
    return;
  }

  // this test is probably unnecessary
  if (pA.showTemperature !== undefined && pA.showTemperature === false) {
    debugLog(pA, 'redflag', 1, 'if showTemperature is false then we should have returned per no Service test above');
    return;
  }

  if (value < -270 || value > 100) {
    if (value === 1000) {
      infoLogOnce(pA, 'current temperature === 1000');
    } else {
      hbLog.info(pA.Name + ' - current temperature out of range: ' + value + ', ignored');
    }
    return;
  }

  pA.CurrentTemperature = Number(value);
  debugLog(pA, 'characteristics', 3, 'update CurrentTemperature:' + pA.CurrentTemperature);
  pA.temperatureSensorService.updateCharacteristic(pA.platform.Characteristic.CurrentTemperature, pA.CurrentTemperature);
}

function currentRelativeHumidity(s: string, pA:BAF) {
  if (!pA.capabilities.hasHumiditySensor) {
    return;
  }

  const value = Number(s);
  debugLog(pA, 'humidity', 2, pA.Name + ' - CurrentRelativeHumidity:' + value);

  // this test probably makes the below, value == 1000, test redundant since Haiku's should not have HumiditySensor service anyway.
  if (!pA.accessory.getService(pA.platform.Service.HumiditySensor)) {
    return;
  }

  if (value < 0 || value > 100) {
    if (value === 1000) {
      infoLogOnce(pA, 'current relative humidity === 1000');
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

function whooshOnState(s: string, pA:BAF) {
  const value = Number(s);
  if (pA.showWhooshSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.whooshSwitchOn = onValue;
    debugLog(pA, 'characteristics', 3, 'update Whoosh:' + pA.whooshSwitchOn);
    pA.whooshSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.whooshSwitchOn);
  }
}

function dimToWarmOnState(s: string, pA:BAF) {
  const value = Number(s);
  if (pA.showDimToWarmSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.dimToWarmSwitchOn = onValue;
    debugLog(pA, 'characteristics', 3, 'update Dim to Warm:' + pA.dimToWarmSwitchOn);
    pA.dimToWarmSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.dimToWarmSwitchOn);
  }
}

function ecoModeOnState(s: string, pA:BAF) {
  const value = Number(s);
  if (pA.showEcoModeSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.ecoModeSwitchOn = onValue;
    debugLog(pA, 'characteristics', 3, 'update Eco Mode:' + pA.ecoModeSwitchOn);
    pA.ecoModeSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.ecoModeSwitchOn);
  }
}

function UVCOnState(s: string, pA:BAF) {
  if (pA.noLights) {
    return;
  }

  const value = Number(s);
  const onValue = (value === 0 ? false : true);
  pA.UVCSwitchOn = onValue; // we do this even if there's no UVCSwitchService yet, so we can initialize it if/when it's created

  if (pA.UVCSwitchService) {
    debugLog(pA, 'characteristics', 3, 'update UVC Mode:' + pA.UVCSwitchOn);
    pA.UVCSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.UVCSwitchOn);
  }
}

function fanOccupancyDetectedState(s: string, pA:BAF) {
  const value = Number(s);
  if (pA.showFanOccupancySensor) {
    const occupancy = (value === 0 ? false : true);
    pA.fanOccupancyDetected = occupancy;
    debugLog(pA, ['occupancy', 'characteristics'], [1, 3], 'update Fan Occupancy:' + pA.fanOccupancyDetected);
    pA.fanOccupancySensorService.updateCharacteristic(pA.platform.Characteristic.OccupancyDetected, value);
  }
}

function lightOccupancyDetectedState(s: string, pA:BAF) {
  const value = Number(s);
  if (pA.showLightOccupancySensor) {
    const occupancy = (value === 0 ? false : true);
    pA.lightOccupancyDetected = occupancy;
    debugLog(pA, ['occupancy', 'characteristics'], [1, 3], 'update Light Occupancy:' + pA.lightOccupancyDetected);
    pA.lightOccupancySensorService.updateCharacteristic(pA.platform.Characteristic.OccupancyDetected, value);
  }
}


// keeping track to gather clues in unending effort to ID unknown codes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mysteryCode(value: string, pA:BAF, code: string) {
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
function codeWatch(s: string, v: string|number|Buffer, m: Buffer, pA:BAF) {
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
function debugLog(pA:BAF, logTag:string|string[], logLevel:number|number[], logMessage:string) {
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

function debugLogOnce(pA:BAF, logTag:string|string[], logLevel:number|number[], logMessage:string) {
  if (messagesLogged.includes(logMessage)) {
    return;
  } else {
    debugLog(pA, logTag, logLevel, logMessage);
    messagesLogged.push(logMessage);
  }
}

function infoLogOnce(pA:BAF, logMessage: string) {
  if (messagesLogged.includes(logMessage)) {
    return;
  } else {
    hbLog.info(pA.Name + ' - ' + logMessage);
    messagesLogged.push(logMessage);
  }
}

function clientWrite(client, b, pA:BAF) {
  debugLog(pA, 'network', 7, 'sending ' + b.toString('hex'));
  try  {
    client.write(b);
  } catch {
    hbLog.warn(pA.Name + ' - clientWrite(..., ' + b.toString('hex') + ') failed');
  }
}

function getVarint(b: Buffer): [Buffer, number] {
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

function getProtoElements(b: Buffer): [Buffer, number, number] {
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

// protbuf types
// 0	VARINT	int32, int64, uint32, uint64, sint32, sint64, bool, enum
// 1	I64	fixed64, sfixed64, double
// 2	LEN	string, bytes, embedded messages, packed repeated fields
// 3	SGROUP	group start (deprecated)
// 4	EGROUP	group end (deprecated)
// 5	I32	fixed32, sfixed32, float

type funCall = [((s: string, pA: BigAssFans_i6PlatformAccessory) => void), string];
let debugLastFanOccupancyValue = 0;
let debugLastLightOccupancyValue = 0;
const rebootReasons = [
  'zero entry',
  'Unknown',
  'Other',
  'PowerOn',
  'Software',
  'IndependentWatchdog',
  'TaskWatchdog',
  'BrownOut',
  'LowPower',
  'Lockup',
  'Pin',
];
let uptimeLogged = false;
let lastRebootCount = 0;
let showRebootReason = true;

function buildFunStack(b:Buffer, pA: BAF): funCall[] {
  let type: number;
  let field: number;
  let length: number;
  let s:string, v: number;

  const funStack: funCall[] = [];

  debugLog(pA, 'protoparse', 1, 'buildFunStack: entered');

  [b, type, field] = getProtoElements(b);
  debugLog(pA, 'protoparse', 1, 'field: ' + field);
  if (field === 2) { // top level
    [b, length] = getVarint(b);
    [b, type, field] = getProtoElements(b);
    debugLog(pA, 'protoparse', 1, '  field: ' + field);

    while (b.length > 0) {
      if (field === 4)  { // level 2
        [b, length] = getVarint(b);
        const remainingLength = (b.length) - length;

        while (b.length > remainingLength) {
          [b, type, field] = getProtoElements(b);
          debugLog(pA, 'protoparse', 1, '    field: ' + field);
          if (field === 2) {
            [b, length] = getVarint(b);
            [b, type, field] = getProtoElements(b);
            debugLog(pA, 'protoparse', 1, '      field: ' + field);
            switch (field) {
              case 2: // product type/model
                [b, s] = getString(b);
                funStack.push([productType, s]);
                break;
              case 7: // firmware version (sometimes zero-length?!)
                [b, s] = getString(b);
                funStack.push([firmwareVersion, s]);
                break;
              case 43:  // fan on/off/auto
                [b, v] = getValue(b);
                if (pA.capabilities.hasFan) {
                  funStack.push([fanOnState, String(v)]);
                }
                break;
              case 44:  // rotation direction
                [b, v] = getValue(b);
                if (pA.capabilities.hasFan) {
                  funStack.push([fanRotationDirection, String(v)]);
                }
                break;
              case 46:  // fan rotation speed
                [b, v] = getValue(b);
                if (pA.capabilities.hasFan) {
                  funStack.push([fanRotationSpeed, String(v)]);
                }
                break;
              case 58:  // whoosh
                [b, v] = getValue(b);
                if (pA.capabilities.hasFan) {
                  funStack.push([whooshOnState, String(v)]);
                }
                break;
              case 65:  // eco mode (haiku)
                [b, v] = getValue(b);
                if (pA.capabilities.hasEcoMode) {
                  funStack.push([ecoModeOnState, String(v)]);
                }
                break;
              case 66:  // fan_occupancy_detected (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
                [b, v] = getValue(b);
                if (pA.capabilities.hasOccupancySensor) {
                  funStack.push([fanOccupancyDetectedState, String(v)]);
                }
                if (v !== debugLastFanOccupancyValue) {
                  debugLog(pA, 'occupancy', 1, `fan occupancy: ${v} detected per field: ${field}`);
                }
                debugLastFanOccupancyValue = v;
                break;
              case 67:  // fan on means auto
                [b, v] = getValue(b);
                if (v) {
                  debugLog(pA, 'newcode', 1, `fan on means auto: ${v} field: ${field}`);
                }
                break;
              case 68:  // light on/off/auto
                [b, v] = getValue(b);
                if (pA.capabilities.hasLight) {
                  funStack.push([lightOnState, String(v)]);
                }
                break;
              case 69:  // light brightness
                [b, v] = getValue(b);
                if (pA.capabilities.hasLight) {
                  funStack.push([lightBrightness, String(v)]);
                }
                break;
              case 71:  // color temperature
                [b, v] = getValue(b);
                if (pA.capabilities.hasColorTempControl) {
                  funStack.push([lightColorTemperature, String(v)]);
                }
                break;
              case 77:  // light dim to warm
                [b, v] = getValue(b);
                if (pA.capabilities.hasLight) {
                  funStack.push([dimToWarmOnState, String(v)]);
                }
                break;
              case 82:  // lightSelector aka multiple light mode 0/all, 1/downlight, 2/uplight
                [b, v] = getValue(b);
                // funStack.splice(0, 0, [setTargetBulb, String(v)]);
                // debugLog(pA, 'light', 2, 'inserted setTargetBulb at start of funStack');
                funStack.push([setTargetBulb, String(v)]);
                break;
              case 85:  // light occupied
                [b, v] = getValue(b);
                if (pA.capabilities.hasOccupancySensor) {
                  funStack.push([lightOccupancyDetectedState, String(v)]);
                }
                if (v !== debugLastLightOccupancyValue) {
                  debugLog(pA, 'occupancy', 1, `light occupancy: ${v} detected per field: ${field}`);
                }
                debugLastLightOccupancyValue = v;
                break;
              case 86:  // temperature
                [b, v] = getValue(b);
                if (pA.capabilities.hasTempSensor) {
                  funStack.push([currentTemperature, String(v/100)]);
                }
                break;
              case 87:  // humidity
                [b, v] = getValue(b);
                if (pA.capabilities.hasHumiditySensor) {
                  funStack.push([currentRelativeHumidity, String(v/100)]);
                }
                break;
              case 109: // light on means auto
                [b, v] = getValue(b);
                if (v) {
                  debugLog(pA, 'newcode', 1, `light on means auto: ${v} field: ${field}`);
                }
                break;
              case 172: // UV-C enabled
                [b, v] = getValue(b);
                if (pA.capabilities.hasUVCLight) {
                  funStack.push([UVCOnState, String(v)]);
                }
                break;

              // ignore strings / messages
              case 1: // name
              case 4: // local datetime
              case 5: // UTC datetime
              case 6: // time zone
              case 8: // MAC address
              case 9: // cloud ID
              case 10:  // fan's UUID
              case 11:  // website - api.bigassfans.com (cloud server )
              case 13:  // api version (from https://github.com/jfroy/aiobafi6/blob/main/proto/aiobafi6.proto)
              case 37:  // pcba part number
              case 38:  // pcba revision
              case 83:  // standby LED - message: 1/color reset, 2/enabled, 3/percent, 4/red, 5/green, 6/blue
              case 120: // IP address
              case 139: // wall control configuration - message: 1/top button function, 2/bottom button function (see schema)
                [b, s] = getString(b);  // ignore
                break;

              // ignore numbers
              case 15:  // device type ID
              case 45:  // fan speed as %
              case 47:  // fan auto comfort
              case 48:  // comfort ideal temperature
              case 50:  // comfort min speed
              case 51:  // comfort max speed
              case 52:  // fan auto -> motion -> motion sense switch (fan occupancy enable)
              case 53:  // fan auto -> motion -> motion timeout (time)
              case 54:  // fan return to auto (return to auto switch)
              case 55:  // fan return to auto (return to auto timeout)
              case 60:  // comfort heat assist
              case 61:  // comfort sense heat assist speed
              case 62:  // comfort sense heat assist direction
              case 63:  // target revolutions per minute
              case 64:  // actual rpm
              case 70:  // brightness as level (0,1-16)
              case 72:  // light occupancy enabled
              case 73:  // light auto motion timeout (time)
              case 74:  // light return to auto (return to auto switch)
              case 75:  // light return to auto (return after)
              case 78:  // warmest color temperature
              case 79:  // coolest color temperature
              case 95:  // fan timer minutes
              case 96:  // fan timer UTC expiration
              case 134: // LED indicators enabled
              case 135: // audible indicator enabled
              case 136: // legacy IR remote enabled
              case 140: // assist with - 0/nothing, 1/heating, 2/cooling, 3/all
              case 150: // remote discovery enabled
              case 151: // external device count
              case 153: // bluetooth remote supported
              case 173: // UV-C life
                [b, v] = getValue(b); // ignore
                debugLog(pA, 'protoparse', 1, '        value: ' + v);
                break;

              // mystery strings
              case 56:
              case 59:
              case 76:
                [b, s] = getString(b);
                debugLog(pA, 'protoparse', 1, `        string: "${s}"`);
                debugLog(pA, 'cluing', 6, `field ${field}, mystery string: "${s}"`);
                break;

              // mystery numbers
              case 3:
              case 14:
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
              case 84:  // issue #17/Kohle81/Ventilator (Haiku L Series [3.1.1])
              case 89:
              case 118:
              case 121:
              case 133:
              case 137:
              case 138:
              case 174:
              case 175:
                [b, v] = getValue(b);
                debugLog(pA, 'protoparse', 1, '        value: ' + v);
                debugLog(pA, 'cluing', 6, 'field ' + field + ', mystery number: ' + v);
                break;

              case 16: {  // detailed version
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, '        field: ' + field);
                  switch (field) {
                    case 1: // Firmware type - 0/host, 1/wifi, 2/light, 3/motor
                      [b, v] = getValue(b); // ignore
                      debugLog(pA, 'protoparse', 1, '          value: ' + v);
                      break;

                    case 2: // app version
                    case 3: // boot loader version
                      [b, s] = getString(b); // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, field 16 message with subfield: "' + field + '"');
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 17: { // capabilities (including light pressence)
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, '        field: ' + field);
                  switch (field) {
                    case 1: // has temperature sensor
                      [b, v] = getValue(b);
                      pA.capabilities.hasTempSensor = Boolean(v);
                      break;
                    case 2: // has humidity sensor
                      [b, v] = getValue(b);
                      pA.capabilities.hasHumiditySensor = Boolean(v);
                      break;
                    case 3: // has occupancy sensor
                      [b, v] = getValue(b);
                      pA.capabilities.hasOccupancySensor = Boolean(v);
                      break;
                    case 4: // downlight
                      [b, v] = getValue(b);
                      pA.capabilities.hasLight = Boolean(v);
                      break;
                    case 5: // has light sensor
                      [b, v] = getValue(b);
                      pA.capabilities.hasLightSensor = Boolean(v);
                      break;
                    case 6: // has color temp control
                      [b, v] = getValue(b);
                      pA.capabilities.hasColorTempControl = Boolean(v);
                      break;
                    case 7: // has fan
                      [b, v] = getValue(b);
                      pA.capabilities.hasFan = Boolean(v);
                      break;
                    case 8: // has speaker
                      [b, v] = getValue(b);
                      pA.capabilities.hasSpeaker = Boolean(v);
                      break;
                    case 9: // has piezo (?)
                      [b, v] = getValue(b);
                      pA.capabilities.hasPiezo = Boolean(v);
                      break;
                    case 10: // has LED indicators
                      [b, v] = getValue(b);
                      pA.capabilities.hasLEDIndicators = Boolean(v);
                      break;
                    case 11: // has uplight
                      [b, v] = getValue(b);
                      pA.capabilities.hasUplight = Boolean(v);
                      break;
                    case 12: // has UV-C
                      [b, v] = getValue(b);
                      pA.capabilities.hasUVCLight = Boolean(v);
                      break;
                    case 13: // has standby LED
                      [b, v] = getValue(b);
                      pA.capabilities.hasStandbyLed = Boolean(v);
                      break;
                    case 14: // has eco mode
                      [b, v] = getValue(b);
                      pA.capabilities.hasEcoMode = Boolean(v);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, `fell into default, field 17 message with subfield: "${field}"`);
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                if (pA.downlightEquipped !== undefined) {
                  if (pA.capabilities.hasLight !== pA.downlightEquipped) {
                    const str = `downlight presence overrriden by user configuration ("downlightEquipped": ${pA.downlightEquipped})`;
                    pA.capabilities.hasLight = pA.downlightEquipped === true ? true : false;
                    debugLog(pA, 'light', 1, str);
                    infoLogOnce(pA, str);
                  }
                }
                if (pA.uplightEquipped !== undefined) {
                  if (pA.capabilities.hasUplight !== pA.uplightEquipped) {
                    const str = `uplight presence overrriden by user configuration ("uplightEquipped": ${pA.uplightEquipped})`;
                    pA.capabilities.hasUplight = pA.uplightEquipped === true ? true : false;
                    debugLog(pA, 'light', 1, str);
                    infoLogOnce(pA, str);
                  }
                }

                if (!pA.capabilitiesEstablished) {
                  pA.capabilitiesEstablished = true;
                  debugLog(pA, 'newcode', 1, 'capabilities established');
                  logCapabilities(pA);
                  makeServices(pA);
                }

                break;
              }

              case 124: { // WiFi messages
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, '        field: ' + field);
                  switch (field) {
                    case 1: // SSID
                      [b, s] = getString(b); // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      break;
                    case 2: // RSSI (signal strength) in dBm?
                      [b, v] = getValue(b); // ignore
                      debugLog(pA, 'protoparse', 1, '          value: ' + v);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, WiFi messages field: "' + field + '"');
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 152: { // external device version
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, '        field: ' + field);
                  switch (field) {
                    case 1: // external device type - 0/bluetooth remote, 1/bluetooth wall control, 2/unknown device
                    case 7: // reboot reason - 0 thru 9, see schema
                      [b, v] = getValue(b); // ignore
                      debugLog(pA, 'protoparse', 1, '          value: ' + v);
                      debugLog(pA, 'newcode', 1,
                        `protoparse: external device version: ${field === 1 ? 'external device type:' : 'reboot reason:'} ${v}`);
                      break;
                    case 2: // package version
                    case 3: // boot loader version
                    case 4: // mac address
                      [b, s] = getString(b); // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, field 152 message with subfield: "' + field + '"');
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 156: { // manufacturer debug info
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, `        field: ${field}`);
                  if (field > 0 && field <= 7) {
                    [b, v] = getValue(b);
                    debugLog(pA, 'protoparse', 1, '          value: ' + v);
                  } else {
                    v = 0;
                  }
                  switch (field) {
                    case 1: // uptime (minutes)
                      pA.uptimeMinutes = v;
                      if (!uptimeLogged) {
                        debugLog(pA, 'manufacturerDebug', 1, `uptime: ${toDaysHoursMinutesString(v)}`);
                        uptimeLogged = true;
                      }
                      break;
                    case 2: // reboot count total
                      if (v !== lastRebootCount) {
                        debugLog(pA, 'manufacturerDebug', 1, `reboot count total: ${v}`);
                        showRebootReason = true;
                      }
                      lastRebootCount = v;
                      break;
                    case 3: // reboot count since por(?)
                      debugLog(pA, 'manufacturerDebug', 1, `reboot count since por: ${v}`);
                      break;
                    case 4: // last reboot reason (see schema)
                      if (showRebootReason) {
                        debugLog(pA, 'manufacturerDebug', 1, `reboot reason: ${rebootReasons[v]}`);
                        showRebootReason = false;
                      }
                      break;
                    case 5: // last reboot details
                      debugLog(pA, 'manufacturerDebug', 1, `last reboot details: ${v}`);
                      break;
                    case 6: // software error - issue #17-19/afellows77/Haiku L Series [3.1.1])
                      debugLog(pA, 'manufacturerDebug', 1, `software error: ${v}`);
                      break;
                    case 7: // software error details
                      debugLog(pA, 'manufacturerDebug', 1, `software error details: ${v}`);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, `fell into default, field 156, subfield: "${field}"`);
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 171: { // group container
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, `        field: ${field}`);
                  switch (field) {
                    case 2: // uuid
                      [b, s] = getString(b);  // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      break;
                    case 3: // name
                      [b, s] = getString(b);  // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, 'fell into default, field 171 message with subfield: "' + field + '"');
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 176: {  // issue #17/Kohle81/Ventilator (Haiku L Series [3.1.1])
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, `        field: ${field}`);
                  switch (field) {
                    case 1:
                    case 2:
                    case 4:
                    case 5:
                    case 7:
                      [b, v] = getValue(b);
                      debugLog(pA, 'cluing', 6, `field 176/${field}, mystery value: ${v}`);
                      debugLog(pA, 'protoparse', 1, '          value: ' + v);
                      break;

                    case 3: {
                      [b, length] = getVarint(b);
                      const remainingLength = (b.length) - length;
                      while (b.length > remainingLength) {
                        [b, type, field] = getProtoElements(b);
                        debugLog(pA, 'protoparse', 1, `          field: ${field}`);
                        switch (field) {
                          case 0:
                            [b, s] = getString(b);  // ignore
                            debugLog(pA, 'protoparse', 1, `            string: "${s}"`);
                            break;

                          default:
                            debugLog(pA, 'cluing', 1, `fell into default, field 176/3 message with subfield: "${field}"`);
                            b = doUnknownField(b, type, pA);
                            break;
                        }
                      }
                      break;
                    }

                    default:
                      debugLog(pA, 'cluing', 1, `fell into default, field 176 message with subfield: "${field}"`);
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 177: {  // issue #17/Kohle81/Ventilator (Haiku L Series [3.1.1])
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, `        field: ${field}`);
                  switch (field) {
                    case 4:
                    case 5:
                    case 7:
                      [b, v] = getValue(b);
                      debugLog(pA, 'protoparse', 1, '          value: ' + v);
                      debugLog(pA, 'cluing', 6, `field 177/${field}, mystery number: ${v}`);
                      break;

                    case 3:
                      [b, s] = getString(b);  // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      debugLog(pA, 'cluing', 6, `field 177/${field}, mystery string: "${s}"`);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, `fell into default, field 177 message with subfield: "${field}"`);
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 178: {  // issue #17/Kohle81/Ventilator (Haiku L Series [3.1.1])
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, `        field: ${field}`);
                  switch (field) {
                    case 1:
                    case 4:
                    case 5:
                    case 7:
                      [b, v] = getValue(b);
                      debugLog(pA, 'protoparse', 1, '          value: ' + v);
                      debugLog(pA, 'cluing', 6, `field 178/${field}, mystery number: ${v}`);
                      break;

                    case 3:
                      [b, s] = getString(b);  // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      debugLog(pA, 'cluing', 6, `field 178/${field}, mystery string: "${s}"`);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, `fell into default, field 178 message with subfield: "${field}"`);
                      b = doUnknownField(b, type, pA);
                      break;
                  }
                }
                break;
              }

              case 179: {  // issue #17/Kohle81/Ventilator (Haiku L Series [3.1.1])
                [b, length] = getVarint(b);
                const remainingLength = (b.length) - length;
                while (b.length > remainingLength) {
                  [b, type, field] = getProtoElements(b);
                  debugLog(pA, 'protoparse', 1, `        field: ${field}`);
                  switch (field) {
                    case 2:
                    case 4:
                    case 5:
                    case 7:
                      [b, v] = getValue(b);
                      debugLog(pA, 'protoparse', 1, '          value: ' + v);
                      debugLog(pA, 'cluing', 6, `field 179/${field}, mystery number: ${v}`);
                      break;

                    case 3:
                      [b, s] = getString(b);  // ignore
                      debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                      debugLog(pA, 'cluing', 6, `field 179/${field}, mystery string: "${s}"`);
                      break;

                    default:
                      debugLog(pA, 'cluing', 1, `fell into default, field 179 message with subfield: "${field}"`);
                      b = doUnknownField(b, type, pA);
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
          } else if (field === 3) {  // schedule job
            [b, length] = getVarint(b);
            const residualLength = (b.length) - length;
            while (b.length > residualLength) {
              [b, type, field] = getProtoElements(b);
              debugLog(pA, 'protoparse', 1, '      field: ' + field);
              switch (field) {
                case 1: // action - 0/no action, 1/update, 2/remove, 3/read
                case 3: // schedules acount
                case 4: // schedules max
                  [b, v] = getValue(b); // ignore
                  debugLog(pA, 'protoparse', 1, '        value: ' + v);
                  break;
                case 2: { // schedule - see schema, there's more than what's noted here
                  [b, length] = getVarint(b);
                  const residualLength = (b.length) - length;
                  while (b.length > residualLength) {
                    [b, type, field] = getProtoElements(b);
                    debugLog(pA, 'protoparse', 1, '        field: ' + field);
                    switch (field) {
                      case 1: // id
                        [b, v] = getValue(b); // ignore
                        debugLog(pA, 'protoparse', 1, '        value: ' + v);
                        break;
                      case 2: // name
                        [b, s] = getString(b);  // ignore
                        debugLog(pA, 'protoparse', 1, `          string: "${s}"`);
                        break;
                      case 3: { // devices
                        let bytes: Buffer;
                        [b, bytes] = getBytes(b);  // ignore
                        debugLog(pA, 'protoparse', 1, '          buf:');
                        for (const item of bytes) {
                          debugLog(pA, 'protoparse', 1, `            ${item}`);
                        }
                        break;
                      }
                      case 4: { // days
                        [b, length] = getVarint(b);
                        const residualLength = (b.length) - length;
                        while (b.length > residualLength) {
                          [b, v] = getValue(b); // ignore
                          debugLog(pA, 'protoparse', 1, '            value: ' + v);
                        }
                        break;
                      }
                      case 5: // undocumented (varint per protobuf-decoder.netlify.app)
                      case 6: // is enabled
                        [b, v] = getValue(b); // ignore
                        debugLog(pA, 'protoparse', 1, '          value: ' + v);
                        break;
                      case 7: // start event
                      case 8: { // end event
                        const field7or8 = field;
                        [b, length] = getVarint(b);
                        const residualLength = (b.length) - length;
                        while (b.length > residualLength) {
                          [b, type, field] = getProtoElements(b);
                          debugLog(pA, 'protoparse', 1, '          field: ' + field);
                          switch (field) {
                            case 1: // time
                              [b, s] = getString(b);  // ignore
                              debugLog(pA, 'protoparse', 1, `            string: "${s}"`);
                              break;
                            case 2: { // properties
                              [b, length] = getVarint(b);
                              const residualLength = (b.length) - length;
                              while (b.length > residualLength) {
                                [b, type, field] = getProtoElements(b);
                                debugLog(pA, 'protoparse', 1, '            field: ' + field);
                                switch (field) {
                                  case 1: // fan mode - 0/off, 1/on, 2/auto
                                  case 2: // fan direction
                                  case 3: // fan percent
                                  case 4: // fan speed
                                  case 5: // light mode - 0/off, 1/on, 2/auto
                                  case 6: // light percent
                                  case 7: // light level
                                  case 8: // light color temperature
                                  case 9: // up light percent
                                  case 10: // multiple light mode = 0/all lights, 1/down light, 2/up light
                                  case 11: // comfort sense enable
                                  case 12: // comfort sense ideal temperature
                                  case 13: // comfort sense min speed
                                  case 14: // comfort sense max speed
                                  case 15: // fan occupancy enabled
                                  case 16: // fan occupancy timeout
                                  case 17: // light occupancy enabled
                                  case 18: // light occupancy timeout
                                    [b, v] = getValue(b); // ignore
                                    debugLog(pA, 'protoparse', 1, '              value: ' + v);
                                    break;

                                  default:
                                    debugLog(pA, 'cluing', 1, `            unknown schedule field 2/${field7or8}/2/${field}`);
                                    b = doUnknownField(b, type, pA);
                                    break;
                                }
                              }
                              break;
                            }

                            default:
                              debugLog(pA, 'cluing', 1, `          unknown schedule field 2/${field7or8}-${field}`);
                              b = doUnknownField(b, type, pA);
                              break;
                          }
                        }
                        break;
                      }

                      default:
                        debugLog(pA, 'cluing', 1, `        unknown schedule field 2-${field}`);
                        b = doUnknownField(b, type, pA);
                        break;
                    }
                  }
                  break;
                }

                default:
                  debugLog(pA, 'cluing', 1, 'unknown schedule field ' + field);
                  b = doUnknownField(b, type, pA);
                  break;
              }
            }
          } else {
            debugLog(pA, ['cluing', 'redflags'], [1, 1], `unexpected field 2 sub level 4 field: ${field}, bailing out`);
            b = doUnknownField(b, type, pA);
            return funStack;
          }
        }
      } else if (field === 5) { // seconds since unix epoch
        [b, v] = getValue(b); // ignore
      } else if (field === 6) { // 32-byte hash
        [b, s] = getString(b);  // ignore
      } else {
        debugLog(pA, 'cluing', 1, 'surprise field: ' + field);
        b = doUnknownField(b, type, pA);
      }

      if (b.length > 0) {
        [b, type, field] = getProtoElements(b);
        debugLog(pA, 'protoparse', 1, '    field: ' + field);
      }
    }
  } else {
    debugLog(pA, 'redflags', 1, 'top level message, expected field "2", got field "' + field + '"');
    b = doUnknownField(b, type, pA);
  }

  debugLog(pA, 'protoparse', 1, 'buildFunStack: leaving');

  return funStack;
}

function logCapabilities(pA:BigAssFans_i6PlatformAccessory) {
  const c = pA.capabilities;
  if (c.hasTempSensor) {
    debugLog(pA, 'capabilities', 1, 'has temperature sensor');
  } else {
    debugLog(pA, 'capabilities', 1, 'no temperature sensor');
  }
  if (c.hasHumiditySensor) {
    debugLog(pA, 'capabilities', 1, 'has humidity sensor');
  } else {
    debugLog(pA, 'capabilities', 1, 'no humidity sensor');
  }
  if (c.hasOccupancySensor) {
    debugLog(pA, 'capabilities', 1, 'has occupancy sensor');
  } else {
    debugLog(pA, 'capabilities', 1, 'no occupancy sensor');
  }
  if (c.hasLight) {
    debugLog(pA, 'capabilities', 1, 'has downlight');
  } else {
    debugLog(pA, 'capabilities', 1, 'no downlight');
  }
  if (c.hasLightSensor) {
    debugLog(pA, 'capabilities', 1, 'has light sensor');
  } else {
    debugLog(pA, 'capabilities', 1, 'no light sensor');
  }
  if (c.hasColorTempControl) {
    debugLog(pA, 'capabilities', 1, 'has color temperature control');
  } else {
    debugLog(pA, 'capabilities', 1, 'no color temperature control');
  }
  if (c.hasFan) {
    debugLog(pA, 'capabilities', 1, 'has fan');
  } else {
    debugLog(pA, 'capabilities', 1, 'no fan');
  }
  if (c.hasSpeaker) {
    debugLog(pA, 'capabilities', 1, 'has speaker');
  } else {
    debugLog(pA, 'capabilities', 1, 'no speaker');
  }
  if (c.hasPiezo) {
    debugLog(pA, 'capabilities', 1, 'has piezo');
  } else {
    debugLog(pA, 'capabilities', 1, 'no piezo');
  }
  if (c.hasLEDIndicators) {
    debugLog(pA, 'capabilities', 1, 'has LED indicators');
  } else {
    debugLog(pA, 'capabilities', 1, 'no LED indicators');
  }
  if (c.hasUplight) {
    debugLog(pA, 'capabilities', 1, 'has uplight');
  } else {
    debugLog(pA, 'capabilities', 1, 'no uplight');
  }
  if (c.hasUVCLight) {
    debugLog(pA, 'capabilities', 1, 'has UV-C');
  } else {
    debugLog(pA, 'capabilities', 1, 'no UV-C');
  }
  if (c.hasStandbyLed) {
    debugLog(pA, 'capabilities', 1, 'has standby LED');
  } else {
    debugLog(pA, 'capabilities', 1, 'no standby LED');
  }
  if (c.hasEcoMode) {
    debugLog(pA, 'capabilities', 1, 'has eco mode');
  } else {
    debugLog(pA, 'capabilities', 1, 'no eco mode');
  }
}
// const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function doUnknownField(b: Buffer, type: number, pA: BAF) {
  if (type === 0) {
    let value: number;
    [b, value] = getVarint(b);
    debugLog(pA, 'cluing', 1, ' value: ' + value);
  } else if (type === 1) {
    debugLog(pA, 'cluing', 1, ' value: ' + hexFormat(b.subarray(0, 8)));
    b = b.subarray(8);
  } else if (type === 2) {
    let length: number;
    [b, length] = getVarint(b);
    debugLog(pA, 'cluing', 1, ' length: ' + length);
    b = b.subarray(length);
  } else if (type === 3 || type === 4) {
    debugLog(pA, 'cluing', 1, ' deprecated protobuf group type');
  } else if (type === 5) {
    debugLog(pA, 'cluing', 1, ' value: ' + hexFormat(b.subarray(0, 4)));
    b = b.subarray(4);
  }
  return b;
}

function getBytes(b: Buffer) : [Buffer, Buffer] {
  let length: number;
  [b, length] = getVarint(b);
  return [b.subarray(length), b.subarray(0, length)];
}

function getString(b: Buffer) : [Buffer, string] {
  let length: number;
  [b, length] = getVarint(b);
  return [b.subarray(length), b.subarray(0, length).toString()];
}

function getValue(b: Buffer) : [Buffer, number] {
  let varInt: number;
  [b, varInt] = getVarint(b);

  return [b, varInt];
}

function toDaysHoursMinutesString(minutes: number) : string {
  // hbLog.debug(`toDaysHoursMinutesString/minutes: ${minutes}`);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor(minutes % (24 * 60) / 60);

  return `${days} ${days === 1 ? 'day' : 'days'} ${hours.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}
