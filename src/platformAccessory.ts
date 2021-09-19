/* eslint-disable no-multi-spaces */

import { Service, PlatformAccessory, CharacteristicValue, Logger } from 'homebridge';
import { BigAssFans_i6Platform } from './platform';

// https://stackoverflow.com/questions/38875401/getting-error-ts2304-cannot-find-name-buffer
declare const Buffer; // this seems to ward off typescripts whining about buffer methods such as length, etc.

let hbLog: Logger;
const debugLevels:number[] = [];
debugLevels['cluing'] = 3;
debugLevels['network'] = 0;
debugLevels['progress'] = 0;
debugLevels['characteristics'] = 0;
debugLevels['newcode'] = 0;

const MAXFANSPEED = 7;

const MAXEBUGLEVEL = 99;

// property table columns
const DECODEVALUEFUNCTION = 0;
const PROPERTYHANDLERFUNCTION = 1;

const ONEBYTEHEADER = [0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03];

export class BigAssFans_i6PlatformAccessory {
  public fanService!: Service;
  public lightBulbService!: Service;
  public humiditySensorService!: Service;
  public temperatureSensorService!: Service;
  public whooshSwitchService!: Service;
  public dimToWarmSwitchService!: Service;
  public fanAutoSwitchService!: Service;

  public lightStates = {
    On: true,
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

  public IP: string;
  public MAC: string;
  public Name = 'naamloos';
  public SSID = 'apname';
  public Model = 'i6';

  public debugLevel = 1;

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
    private readonly accessory: PlatformAccessory,
  ) {
    hbLog = platform.log;
    this.IP = accessory.context.device.ip;
    this.MAC = accessory.context.device.mac;

    for (const hdr in this.propertiesTable) {
      const a = hdr.split(',');
      if (a.length === 1) {
        this.oneByteHeaders.push(parseInt(hdr));
      }
    }

    // deprecating megaDebugLevel - but will interpret it for the time being
    if (accessory.context.device.megaDebugLevel !== undefined) {
      hbLog.warn('"megaDebugLevel" in configuration is deprecated.');
      if (accessory.context.device.megaDebugLevel.toLowerCase() === 'max' ||
      (accessory.context.device.megaDebugLevel as number) > MAXEBUGLEVEL) {
        this.debugLevel = MAXEBUGLEVEL;
      } else {
        this.debugLevel = this.accessory.context.device.megaDebugLevel as number;
      }
      debugLog('progress', 1, 'megaDebugLevel:' + (this.accessory.context.device.megaDebugLevel as number));
      for (const index in debugLevels) {
        debugLevels[index] = this.debugLevel;
      }
    } else {
      this.debugLevel = 3;
    }

    // this is the replacement debug logging thing
    if (this.accessory.context.device.debugLevels !== undefined) {
      for (const debugEntry of this.accessory.context.device.debugLevels) {
        const entry:(string | number)[] = debugEntry as (string | number)[];
        debugLevels[entry[0]] = entry[1];
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

    /**
    * set accessory information
    */

    const capitalizeName = accessory.context.device.name[0] === accessory.context.device.name[0].toUpperCase();
    let accessoryName:string;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Big Ass Fans')
      .setCharacteristic(this.platform.Characteristic.Model, 'i6')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.MAC);

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
    this.temperatureSensorService = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor);
    accessoryName = capitalizeName ?  ' Temperature' : ' temperature';
    this.temperatureSensorService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + accessoryName);
    this.temperatureSensorService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

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
      accessoryName = capitalizeName ?  ' Auto' : ' auto';
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

    /**
    * open the fan's communication port, establish the data and error callbacks, send the initialization sequence  and start
    * the heartbeat
    */
    networkSetup(this);
    debugLog('progress', 1, 'constructed');
  }

  /**
  * 'SET' request is issued when HomeKit wants us to change the state of an accessory.
  * 'GET' request is issued  when HomeKit wants to know the state of an accessory.
  */

  async setLightOnState(value: CharacteristicValue) {
    debugLog('characteristics',  2, 'Set Characteristic Light On -> ' + value);
    this.lightStates.On = value as boolean;
    clientWrite(this.client,
      Buffer.from(ONEBYTEHEADER.concat([0xa0, 0x04, (this.lightStates.On ? 0x01 : 0x00), 0xc0])));
  }

  async getLightOnState(): Promise<CharacteristicValue> {
    const isOn = this.lightStates.On;
    debugLog('characteristics', 4, 'Get Characteristic Light On -> ' + isOn);
    // if you need to return an error to show the device as 'Not Responding' in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return isOn;
  }

  async setBrightness(value: CharacteristicValue) {
    let b: Buffer;
    if (value === 0) {
      debugLog('characteristics', 2, 'Set Characteristic Brightness -> ' + value);
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
      debugLog('characteristics', 2, 'Set Characteristic Brightness -> ' + value);
      this.lightStates.Brightness = value as number;
      b = Buffer.from(ONEBYTEHEADER.concat([0xa8, 0x04, this.lightStates.Brightness, 0xc0]));
    }
    clientWrite(this.client, b);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const brightness = (this.lightStates.Brightness === 0 ? 1 : this.lightStates.Brightness);
    debugLog('characteristics', 4, 'Get Characteristic Brightness -> ' + brightness);
    return brightness;
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    // const temperature = (this.CurrentTemperature - 32) / 1.8; // convert to celsius
    const temperature = this.CurrentTemperature;
    if (temperature < -270 || temperature > 100) {
      this.platform.log.warn('temperature out of bounds: ', temperature);
      return 0;
    }
    debugLog('characteristics', 4, 'Get Characteristic CurrentTemperature -> ' + temperature);
    return temperature;
  }

  async getCurrentRelativeHumidity(): Promise<CharacteristicValue> {
    const humidity = this.CurrentRelativeHumidity;
    debugLog('characteristics', 4, 'Get Characteristic CurrentRelativeHumidity -> ' + humidity);
    return humidity;
  }

  async setFanOnState(value: CharacteristicValue) {
    debugLog(['newcode', 'characteristics'], [1, 2], 'Set Characteristic Fan On -> ' + value);
    this.fanStates.On = value as boolean;

    // If the fan is in Auto mode and on command in response to this Set from HomeKit,
    // then it's going to reply with FanOn 0x01 which will cause us to drop it out of auto because it's not 0x02.
    // If homekit is telling us to setFanOnState On while it's in Auto Mode, it must be because we changed the speed so,
    // ignore this setFanOnState request.
    if (this.fanAutoSwitchOn && this.fanStates.On) {
      return;
    }

    clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xd8, 0x02, (this.fanStates.On ? 0x01 : 0x00), 0xc0])));
  }

  async getFanOnState(): Promise<CharacteristicValue> {
    const isOn = this.fanStates.On;
    debugLog(['newcode', 'characteristics'], [1, 4], 'Get Characteristic Fan On -> ' + isOn);
    return isOn;
  }

  async setRotationSpeed(value: CharacteristicValue) {
    let b: Buffer;
    if (value === 0) {
      debugLog('characteristics', 2, 'Set Characteristic RotationSpeed -> ' + (value as number) + '%');
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
      debugLog('characteristics', 2, 'Set Characteristic RotationSpeed -> ' + (value as number) + '%');
      this.fanStates.RotationSpeed = Math.round(((value as number) / 100) * MAXFANSPEED);
      if (this.fanStates.RotationSpeed > MAXFANSPEED) {
        this.platform.log.warn('ignoring fan speed > ' + MAXFANSPEED + ': ' + this.fanStates.RotationSpeed);
      }
      b = Buffer.from(ONEBYTEHEADER.concat([0xf0, 0x02, this.fanStates.RotationSpeed, 0xc0]));
    }
    clientWrite(this.client, b);
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {  // get speed as percentage
    let rotationPercent = Math.round((this.fanStates.RotationSpeed / MAXFANSPEED) * 100);
    if (rotationPercent === 0) {
      rotationPercent = 1;
    }
    debugLog('characteristics', 4, 'Get Characteristic RotationSpeed -> ' + rotationPercent + '%');
    return rotationPercent;
  }

  async setRotationDirection(value: CharacteristicValue) {
    debugLog('characteristics', 2, 'Set Characteristic RotationDirection -> ' + value);
    this.fanStates.RotationDirection = value as number;
    clientWrite(this.client,
      Buffer.from(ONEBYTEHEADER.concat([0xe0, 0x02, this.fanStates.RotationDirection, 0xc0]))); // 0 is clockwise, 1 is counterclockwise
  }

  async getRotationDirection(): Promise<CharacteristicValue> {
    const rotationDirection = this.fanStates.RotationDirection;
    debugLog('characteristics', 4, 'Get Characteristic RotationDirection -> ' + rotationDirection);
    return rotationDirection;
  }

  // Mireds!
  async setColorTemperature(value: CharacteristicValue) {
    debugLog('characteristics', 2, 'Set Characteristic ColorTemperature  -> ' + value);
    this.lightStates.ColorTemperature = Math.round(1000000/(value as number));
    const bigNumberArray = stuffed(makeBigAssNumberValues(this.lightStates.ColorTemperature));
    const firstPart = [0xc0, 0x12, bigNumberArray.length + 6, 0x12, bigNumberArray.length + 4, 0x1a,
      bigNumberArray.length + 2, 0xb8, 0x04];
    clientWrite(this.client, Buffer.from(firstPart.concat(bigNumberArray, 0xc0)));
  }

  async getColorTemperature(): Promise<CharacteristicValue> {
    const colorTemperature = Math.round(1000000 / this.lightStates.ColorTemperature);
    debugLog('characteristics', 4, 'Get Characteristic ColorTemperature -> ' + colorTemperature);
    return colorTemperature;
  }

  // set/get won't get called unless showWhooshSwitch is true
  async setWhooshSwitchOnState(value: CharacteristicValue) {
    debugLog('characteristics', 2, 'Set Characteristic Whoosh Switch On -> ' + value);
    this.whooshSwitchOn = value as boolean;
    clientWrite(this.client,
      Buffer.from(ONEBYTEHEADER.concat([0xd0, 0x03, (this.whooshSwitchOn ? 0x01 : 0x00), 0xc0])));
  }

  async getWhooshSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.whooshSwitchOn;
    debugLog('characteristics', 4, 'Get Characteristic Whoosh Switch On -> ' + isOn);
    return isOn;
  }

  // set/get won't get called unless showDimToWarmSwitch is true
  async setDimToWarmSwitchOnState(value: CharacteristicValue) {
    debugLog('characteristics', 2, 'Set Characteristic Dim to Warm Switch On -> ' + value);
    this.dimToWarmSwitchOn = value as boolean;
    clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xe8, 0x04, (this.dimToWarmSwitchOn ? 0x01 : 0x00), 0xc0])));
  }

  async getDimToWarmSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.dimToWarmSwitchOn;
    debugLog('characteristics', 4, 'Get Characteristic Dim to Warm Switch On -> ' + isOn);
    return isOn;
  }

  // set/get won't get called unless showFanAutoSwitch is true
  async setFanAutoSwitchOnState(value: CharacteristicValue) {
    debugLog(['newcode', 'characteristics'], [1, 2], 'Set Characteristic Fan Auto Switch On -> ' + value);
    this.fanAutoSwitchOn = value as boolean;
    if (this.fanAutoSwitchOn) {
      clientWrite(this.client, Buffer.from(ONEBYTEHEADER.concat([0xd8, 0x02, 0x02, 0xc0])));
    } else {
      // in order for fan to turn auto off, we need to tell it to be on or off
      this.setFanOnState(this.fanStates.On);
    }
  }

  async getFanAutoSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.fanAutoSwitchOn;
    debugLog(['newcode', 'characteristics'], [1, 4], 'Get Characteristic Fan Auto Switch On -> ' + isOn);
    return isOn;
  }
}

import net = require('net');
/**
* connect to the fan, send an initialization message, establish the error and data callbacks and start a keep-alive interval timer.
*/
function networkSetup(platformAccessory: BigAssFans_i6PlatformAccessory) {
  platformAccessory.client = net.connect(31415, platformAccessory.IP, () => {
    debugLog('progress', 1, 'connected!');
    platformAccessory.client.setKeepAlive(true);

    clientWrite(platformAccessory.client, Buffer.from([0xc0, 0x12, 0x02, 0x1a, 0x00, 0xc0]));
  });

  let errHandler;

  platformAccessory.client.on('error', errHandler = (err) => {
    if (err.code === 'ECONNRESET') {
      platformAccessory.platform.log.warn('Fan network connection reset [ECONNRESET]. Attempting reconnect in 2 seconds.');
    } else if (err.code === 'EPIPE') {
      platformAccessory.platform.log.warn('Fan network connection broke [EPIPE]. Attempting reconnect in 2 seconds.');
    } else if (err.code === 'ETIMEDOUT') {
      platformAccessory.platform.log.warn('Fan connection timed out [ETIMEDOUT].  '  +
        'Check that your fan has power and the correct IP is in json.config.');
    } else if (err.code === 'ECONNREFUSED') {
      platformAccessory.platform.log.warn('Fan connection refused [ECONNREFUSED].  '  +
          'Check that the correct IP is in json.config.');
    } else {
      platformAccessory.platform.log.warn('Unhandled network error: ' + err.code + '.  Attempting reconnect in 2 seconds.');
    }
    platformAccessory.client = undefined;
    setTimeout(() => {
      // already did this one or more times, don't need to send initilization message
      platformAccessory.client = net.connect(31415, platformAccessory.IP, () => {
        platformAccessory.platform.log.info('reconnected!');
      });
      platformAccessory.client.on('error', (err) => {
        errHandler(err);
      });
      platformAccessory.client.on('data', (data) => {
        onData(platformAccessory, data);
      });
    }, 2000);
  });

  /**
  *  separate the data into chunks as required and feed them to parseFanMessage() one at a time.
  */
  platformAccessory.client.on('data', (data: Buffer) => {
    onData(platformAccessory, data);
  });

  // attempt to prevent the occassional socket reset.
  // sending the mysterious code that the vendor app seems to send once every 15s but I'll go with every minute -  didn't prevent it.
  // can try going to every 15 seconds like the vendor app seems to do. - didn't work
  // perhaps I need to call socket.setKeepAlive([enable][, initialDelay]) when I establish it above? - nope, didn't help
  // obviously, I don't understand this stuff.
  // now I got an EPIPE 5+ hours after a reset, and repeaated EPIPEs evert minute for the next 7 minutes, then one more after 4 minutes
  // then clear sailing for 1+ hours so far.
  setInterval(( )=> {
    if (platformAccessory.client !== undefined) {
      clientWrite(platformAccessory.client, Buffer.from([0xc0, 0x12, 0x04, 0x1a, 0x02, 0x08, 0x03, 0xc0]));
    } else {
      debugLog('network', 3, 'client undefined in setInterval callback');
    }
  }, 60000);
}

function onData(platformAccessory: BigAssFans_i6PlatformAccessory, data: Buffer) {
  debugLog('network', 11, 'raw data: ' + hexFormat(data));
  debugLog('network', 8, 'accessory client got: ' + data.length + ' bytes');

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
        // this.platform.log.debug('start: ' + startIndex + ', end: ' + endIndex + ', length: ' + chunks[numChunks].length);
        numChunks++;
        startIndex = -1;
      }
    }
  }
  // platform.log.debug('numChunks: ' + numChunks);

  // parse each chunk and issue any interesting updates to homekit.
  for (let i = 0; i < numChunks; i++) {
    processFanMessage(platformAccessory, unstuff(chunks[i]));
  }
}

function processFanMessage(platformAccessory: BigAssFans_i6PlatformAccessory, data: typeof Buffer) {
  const log = platformAccessory.platform.log;
  let len = 0;
  let propertyFields: typeof Buffer;

  const rawChunk = data;

  if (data[0] !== 0xc0) {
    log.warn('expected start of message chunk (0x0c), got: ' + hexFormat(data[0]));
    debugLog('network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return;
  }
  data = data.subarray(1); // remove 0xc0

  if (data[0] !== 0x12) {
    log.warn('expected start of message header (0x12), got: ' + hexFormat(data[0]));
    debugLog('network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return;
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
    log.warn('this is not the chunk size we\'re looking for: ' + remainingChunkSize + ', actual: ' + data.length);
    debugLog('network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return;
  }
  if (data.length === 0 || data[0] !== 0x22) {
    log.warn('not good.  apparently we ran off the end of the data buffer');
    debugLog('network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return;
  }
  data = data.subarray(1); // remove the field separator (0x22)

  // accumulate remaining size (bigAssNumber)
  banArray = [];
  while (data.length > 0 && (data[0] !== 0x12 && data[0] !== 0x1a)) {  // 0x12 or 0x1a, apparently neither can be part of a bigAssNumber?
    banArray.push(data[0]);
    data = data.subarray(1); // remove the byte we just consumed
  }
  const chunkSizeSansToken = bigAssNumber(Buffer.from(banArray));

  if (data.length !== (chunkSizeSansToken + 73)) { // 73 - token length + 1 (0xc0)
    log.warn('chunkSizeSansToken: ' + chunkSizeSansToken + 73 + ', not what we expected with data length: ' + data.length);
    debugLog('network', 3, 'rawChunk: ' + hexFormat(rawChunk));
    return;
  }

  if (data[0] !== 0x12) { // then it must be 0x1a.
    // let's see what happens if we just pass it on
  }

  /**
  * pick out the property code and send it to the decode function to get the value from its
  * coded field.  Then call the property's handler function to act on the message's contents (or not.)
  */
  while (data[0] !== 0xc0) {
    if (data[0] === 0x28) { // 0x28 is the start of what looks like a token 72 bytes long followed by 0xc0 end of chunk.
      if (data.length === 73) {
        return;
      } else {
        debugLog('network', 2, 'surprise! token length was: ' + data.length);
      }
    }
    if (data[0] !== 0x12 && data[0] !== 0x1a) {
      platformAccessory.platform.log.warn('expected 0x12|0x1a, got: ', hexFormat(data.subarray(0, 1)));
      debugLog('network', 2, 'unexpected byte in chunk:  ' + hexFormat(data) + ' from: ' + hexFormat(rawChunk));
      return;
    }
    data = data.subarray(1);  // remove the 'start of header' (0x12|0x1a) from the remaining data

    len = data[0];
    data = data.subarray(1);  // remove the 'length' byte from the remaining data

    propertyFields = data.subarray(0, len); // this is the message - property code and value
    data = data.subarray(len);  // remove the message from the remaining data

    let hdrsize = 2; // most property headers are two bytes
    // // but there are a few single-byte headers
    // if (propertyFields[0] === 0x0a ||
    //     propertyFields[0] === 0x22 ||
    //     propertyFields[0] === 0x2a ||
    //     propertyFields[0] === 0x32 ||
    //     propertyFields[0] === 0x3a ||
    //     propertyFields[0] === 0x42 ||
    //     propertyFields[0] === 0x70 ||
    //     propertyFields[0] === 0x78) {
    //   hdrsize = 1;
    // }
    if (platformAccessory.oneByteHeaders.includes(propertyFields[0])) {
      hdrsize = 1;
    }

    const propertyCodeString = hexFormat(propertyFields.subarray(0, hdrsize));
    const propertyValueField = propertyFields.subarray(hdrsize);

    if (platformAccessory.propertiesTable[propertyCodeString] === undefined) {
      platformAccessory.platform.log.warn('propertiesTable[' + propertyCodeString + '] === undefined');
      continue;
    }

    const decodeValueFunction = platformAccessory.propertiesTable[propertyCodeString][DECODEVALUEFUNCTION];
    if (decodeValueFunction === undefined) {
      platformAccessory.platform.log.warn('No value decoding function for: ', propertyCodeString);
    }
    const parsedValue = decodeValueFunction(propertyValueField, platformAccessory, 'noop');
    if (parsedValue === undefined) {
      platformAccessory.platform.log.warn('Could not decode value for: ', propertyCodeString);
      continue;
    }

    // some unknown codes might be under surveillance - check if this is one of them?
    codeWatch(propertyCodeString, parsedValue, propertyValueField);

    const propertyHandlerFunction = platformAccessory.propertiesTable[propertyCodeString][PROPERTYHANDLERFUNCTION];
    if (propertyHandlerFunction === undefined) {
      platformAccessory.platform.log.warn('undefined handler for:', propertyCodeString);
      continue;
    }

    propertyHandlerFunction(parsedValue, platformAccessory, propertyCodeString);
  }
}

// Property Table
function getPropertiesArray():typeof properties {
  // some gymnastics here to get past lint
  const properties: (((v: number | string, p: BigAssFans_i6PlatformAccessory, s: string) => void) |
  ((b: Buffer|string, p: BigAssFans_i6PlatformAccessory) => string))[][] = [];
  // many of the same codes occur in multiple chunks  (or in the same chunk?)
  properties['0x08, 0x03'] = [dataValue,      mysteryCode],             //  something to do with schedules
  properties['0x0a'] =       [text3Value,     noop];                    //  name
  properties['0x12, 0x02'] = [text3Value,     noop];                    //  model
  properties['0x18, 0xc0'] = [dataValue,      mysteryCode];             //  mystery
  properties['0x22'] =       [text3Value,     noop];                    //  local datetime
  properties['0x2a'] =       [text3Value,     noop];                    //  zulu datetime
  properties['0x32'] =       [text3Value,     noop];                    //  mystery datetime
  properties['0x3a'] =       [text3Value,     noop];                    //  mystery firmware (sometimes zero-length?!)
  properties['0x42'] =       [text3Value,     noop];                    //  MAC address
  properties['0x4a, 0x24'] = [textValue,      mysteryCode];             //  mystery
  properties['0x52, 0x24'] = [textValue,      mysteryCode];             //  mystery
  properties['0x5a, 0x12'] = [text3Value,     noop];                    //  website
  properties['0x6a, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0x70'] =       [intValue,       mysteryCode];             //  mystery
  properties['0x78'] =       [intValue,       mysteryCode];             //  mystery
  properties['0x80, 0x02'] = [intValue,       mysteryCode];             //  mystery
  properties['0x80, 0x03'] = [weatherValue,   noop];                    //  comfort ideal temperature
  properties['0x80, 0x04'] = [intValue,       mysteryCode];             //  mystery
  properties['0x82, 0x01'] = [text4Value,     noop];                    //  mystery firmware
  properties['0x88, 0x02'] = [intValue,       mysteryCode];             //  mystery
  properties['0x88, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0x90, 0x03'] = [intValue,       noop];                    //  comfort min speed
  properties['0x98, 0x03'] = [intValue,       noop];                    //  comfort max speed
  properties['0xa0, 0x03'] = [boolValue,      noop];                    //  fan motion sense
  properties['0xa0, 0x04'] = [onOffAutoValue, lightOnState];            //  light
  properties['0xa8, 0x03'] = [varIntValue,    noop];                    //  fan motion timeout
  properties['0xa8, 0x04'] = [intValue,       lightBrightness];         //  light brightness
  properties['0xa8, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xb0, 0x03'] = [boolValue,      noop];                    //  fan return to auto on/off
  properties['0xb0, 0x04'] = [intValue,       noop];                    //  brightness as level (0,1-16)
  properties['0xb0, 0x05'] = [weatherValue,   currentTemperature];      //  temperature
  properties['0xb0, 0x07'] = [intValue,       mysteryCode];             //  mystery
  properties['0xb0, 0x08'] = [boolValue,      noop];                    //  LED indicators
  properties['0xb0, 0x09'] = [boolValue,      noop];                    //  prevent additional controls
  properties['0xb8, 0x03'] = [varIntValue,    noop];                    //  fan return to auto after
  properties['0xb8, 0x04'] = [varIntValue,    lightColorTemperature];   //  color temperature
  properties['0xb8, 0x05'] = [weatherValue,   currentRelativeHumidity]; //  humidity
  properties['0xb8, 0x08'] = [boolValue,      noop];                    //  beeper
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
  properties['0xd0, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xd0, 0x03'] = [boolValue,      whooshOnState];           //  whoosh
  properties['0xd0, 0x04'] = [boolValue,      noop];                    //  light return to auto on/off
  properties['0xd0, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xd8, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xd8, 0x02'] = [onOffAutoValue, fanOnState];              //  fan on
  properties['0xd8, 0x04'] = [varIntValue,    noop];                    //  light return to auto (time)
  properties['0xda, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0xda, 0x0a'] = [intValue,       mysteryCode];             //  mystery
  properties['0xdb, 0xdc'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe0, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe0, 0x02'] = [boolValue,      fanRotationDirection];    //  rotation direction
  properties['0xe0, 0x03'] = [boolValue,      noop];                    //  comfort heat assist
  properties['0xe0, 0x08'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe2, 0x04'] = [textValue,      mysteryCode];             //  mystery
  properties['0xe2, 0x07'] = [text2Value,     noop];                    //  SSID
  properties['0xe8, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe8, 0x02'] = [intValue,       noop];                    //  fan speed as %
  properties['0xe8, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0xe8, 0x04'] = [boolValue,      dimToWarmOnState];        //  light dim to warm
  properties['0xf0, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xf0, 0x02'] = [intValue,       fanRotationSpeed];        //  fan rotation speed
  properties['0xf0, 0x03'] = [intValue,       mysteryCode];             //  mystery
  properties['0xf0, 0x04'] = [varIntValue,    noop];                    //  warmest color temperature
  properties['0xf8, 0x01'] = [intValue,       mysteryCode];             //  mystery
  properties['0xf8, 0x02'] = [boolValue,      noop];                    //  fan auto comfort
  properties['0xf8, 0x03'] = [intValue,       noop];                    //  revolutions per minute
  properties['0xf8, 0x04'] = [varIntValue,    noop];                    //  coolest color temperature
  // the follwing props in sean9keenan's 'homebridge-bigAssFans createGetField are not listed above - might be in the mystery category
  // LIGHT;LEVEL;MIN
  // LIGHT;LEVEL;MAX
  // LIGHT;AUTO;ON|OFF
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
  return properties;
}

/**
* property handler functions
*/
function lightColorTemperature(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  const mireds = Math.round(1000000 / pA.lightStates.ColorTemperature);
  pA.lightStates.ColorTemperature = Number(value);
  debugLog('characteristics', 2, 'update ColorTemperature: ' + mireds);
  pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.ColorTemperature, mireds);
}

function lightBrightness(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value !== 0) { // don't tell homebridge brightness is zero, it only confuses it.  It'll find out it's off in soon enough.
    /* if (pA.lightStates.homeShieldUp && value != 1) {
      log.debug("uuunnnnnhhhh");
    } else */{
      pA.lightStates.homeShieldUp = false;
      pA.lightStates.Brightness = (value as number);
      debugLog('characteristics', 2, 'update Brightness: ' + pA.lightStates.Brightness);
      pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.Brightness, pA.lightStates.Brightness);
    }
  }
}

function lightOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value === 2) {  // this means the light is in Auto mode -  we don't handle it yet
    return;
  }

  const onValue = (value === 0 ? false : true);
  pA.lightStates.On = onValue;
  debugLog('characteristics', 2, 'update Light On: ' + pA.lightStates.On);
  pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightStates.On);
}

function fanOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showFanAutoSwitch) {
    pA.fanAutoSwitchOn = (value === 2) ? true: false;
    debugLog(['newcode', 'characteristics'], [1, 2], 'update fan auto: ' + pA.fanAutoSwitchOn);
    pA.fanAutoSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanAutoSwitchOn);
  }

  if (value === 2) {
    // if (pA.fanStates.RotationSpeed > 0) {
    //   pA.fanStates.On = true;
    //   debugLog(['newcode', 'characteristics'], [1, 2], 'update FanOn:' + pA.fanStates.On + ' because (auto && speed > 0)');
    //   pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
    // }
  } else {
    const onValue = (value === 0 ? false : true);
    pA.fanStates.On = onValue;
    debugLog(['newcode', 'characteristics'], [1, 2], 'update FanOn: ' + pA.fanStates.On);
    pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
  }
}

function fanRotationDirection(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  //  fan reports if 'reverse rotation' is on or off, homebridge wants rotation direction
  //  reverse switch off (0) == rotation direction counterclockwise (1)
  const rotationDirection = value === 0 ? 1 : 0;
  pA.fanStates.RotationDirection = rotationDirection;
  debugLog('characteristics', 2, 'update RotationDirection: ' + pA.fanStates.RotationDirection);
  pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationDirection, pA.fanStates.RotationDirection);
}

function fanRotationSpeed(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value !== 0) { // don't tell homebridge speed is zero, it only confuses it.  It'll find out it's off in due course.
    pA.fanStates.homeShieldUp = false;
    pA.fanStates.RotationSpeed = (value as number);
    debugLog('characteristics', 2, 'set speed to ' + pA.fanStates.RotationSpeed);
    // convert to percentage for homekit
    const speedPercent = Math.round((pA.fanStates.RotationSpeed / MAXFANSPEED) * 100);
    debugLog('characteristics', 2, 'update RotationSpeed: ' + speedPercent + '%');
    pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationSpeed, speedPercent);

    pA.fanStates.On = true;
    debugLog(['newcode', 'characteristics'], [1, 2], 'update FanOn: ' + pA.fanStates.On + ' because (auto && speed > 0)');
    pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
  } else {
    pA.fanStates.On = false;
    debugLog(['newcode', 'characteristics'], [1, 2], 'update FanOn: ' + pA.fanStates.On + ' because (auto && speed == 0)');
    pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
  }
}

function currentTemperature(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value < -270 || value > 100) {
    pA.platform.log.info('current temperature out of range: ' + value + ', ignored');
    return;
  }

  pA.CurrentTemperature = Number(value);
  debugLog('characteristics', 2, 'update CurrentTemperature:' + pA.CurrentTemperature);
  pA.temperatureSensorService.updateCharacteristic(pA.platform.Characteristic.CurrentTemperature, pA.CurrentTemperature);
}

function currentRelativeHumidity(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value < 0 || value > 100) {
    pA.platform.log.info('current relative humidity out of range: ' + value + ', ignored');
    return;
  }

  pA.CurrentRelativeHumidity = Number(value);
  debugLog('characteristics', 2, 'update CurrentRelativeHumidity:' + pA.CurrentRelativeHumidity);
  pA.humiditySensorService.updateCharacteristic(pA.platform.Characteristic.CurrentRelativeHumidity, pA.CurrentRelativeHumidity);
}

function whooshOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showWhooshSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.whooshSwitchOn = onValue;
    debugLog('characteristics', 2, 'update Whoosh:' + pA.whooshSwitchOn);
    pA.whooshSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.whooshSwitchOn);
  }
}

function dimToWarmOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showDimToWarmSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.dimToWarmSwitchOn = onValue;
    debugLog('characteristics', 2, 'update Dim to Warm:' + pA.dimToWarmSwitchOn);
    pA.dimToWarmSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.dimToWarmSwitchOn);
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
      debugLog('cluing', 3, 'mystery property value: ' + code + ' changed from: ' + p + ', to: ' + v);
      pA.mysteryProperties[code] = v;
    }
  } else {
    debugLog('cluing', 3, 'initial mystery property value: ' + code + ', : ' + v);
    pA.mysteryProperties[code] = v;
  }
}

/**
* value decoding functions
*/

function onOffAutoValue(bytes:Buffer, pA:BigAssFans_i6PlatformAccessory): number|string|undefined {
  switch (bytes[0]) {
    case 0x00: // thing is off, auto is off
    case 0x01: // thing is on, may or may not be due to auto being on
    case 0x02: // auto is on fan may or may not be spinning
      return (bytes[0]);
    default:
      pA.platform.log.warn('unknown value for \'on|off|auto\': ', hexFormat(bytes));
      return undefined;
  }
}

function boolValue(bytes:Buffer, pA:BigAssFans_i6PlatformAccessory): number|string|undefined {
  switch (bytes[0]) {
    case 0x00:
    case 0x01:
      return(bytes[0]);
    default:
      pA.platform.log.warn('unknown value for "on|off" or "direction": ' + hexFormat(bytes));
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
  return(bytes.subarray(1).toString());
}

function text2Value(bytes:Buffer): number|string {
  return(bytes.subarray(3).toString());
}

function text3Value(bytes:Buffer): number|string {
  return(bytes.subarray(0).toString()); // i.e. subarray.toString();
}

function text4Value(bytes:Buffer): number|string {
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

function dataValue(bytes:Buffer): number|string {
  return(hexFormat(bytes));
}

// a little hack for codes under investigation
function codeWatch(s: string, v: string|number|Buffer, m: Buffer) {
  if (s === '0xe8, 0x01') {
    debugLog('cluing', 4, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } if (s === '0xd8, 0x01') {
    debugLog('cluing', 4, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } else if (s === '0x18, 0xc0') {
    debugLog('cluing', 4, 'code watch - s: ' + s + ', m: ' + hexFormat(m));
  } else if (s === '0xda, 0x0a') {
    debugLog('cluing', 4, 'code watch - s: ' + s + ', v: ' + hexFormat(v));
  }
}

const ESC = 0xDB;
const START = 0xc0;
const ESC_STUFF = 0xDD;
const START_STUFF = 0xDC;

function unstuff(data:typeof Buffer):typeof Buffer {
  const unstuffedData: number[] = [];
  if (data[0] !== START) {
    debugLog('network', 1, 'data doesn\'t begin with START byte - all bets are off');
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

function debugLog(logTag:string|string[], logLevel:number|number[], logMessage:string) {
  if (typeof(logTag) === 'string') {
    if (debugLevels[logTag] === undefined) {
      hbLog.warn('no such logging tag: "' + logTag + '", the message is: "' + logMessage + '"');
    }
    if (debugLevels[logTag] >= logLevel) {
      hbLog.debug(logMessage);
    }
  } else {
    for (let i = 0; i < logTag.length; i++) {
      if (debugLevels[logTag[i]] === undefined) {
        hbLog.warn('no such logging tag: "' + logTag[i] + '", the message is: "' + logMessage + '"');
      }
      if (debugLevels[logTag[i]] >= logLevel[i]) {
        hbLog.debug(logMessage);
      }
    }
  }
}

function clientWrite(client, b) {
  debugLog('network', 7, 'sending ' + b.toString('hex'));
  try  {
    client.write(b);
  } catch {
    // hbLog.warn('clientWrite(' + client + ', ' + b.toString('hex') + ') failed');
    hbLog.warn('clientWrite(..., ' + b.toString('hex') + ') failed');
  }
}
