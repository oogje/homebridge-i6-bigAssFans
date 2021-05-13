/* eslint-disable no-multi-spaces */
/**
 * record last message received for debugging
 *
 * check what fan says name/mac are against the config file and warn?  If IP is wrong all bets are off anyway.
 *
 * test multiple fans in config file.   maybe code a dummy fan with a self assigned ip - 169.254.nnn.nnn
 *
 * more switches!
 *
 * implement max retries and backoffs on network errors?
 *
 * figure out how to decode the type 11 message chunks.
 *
 * still don't understand Promise<CharacteristicValue> in the Get function declarations that came with the example template.
 *
 * use Characteristic props for range checking Get/Set values
 *
 * resend command on network error.  but so far haven't been able to determine which write failed to make it to the fan,
 * so can't resend.
 *
 * try socket level keepalives
 *
 * nevermind the chunk headers, don't understand them so can't count on them.  Just send all messages on to be processed.
 *
 * bigAssNumber function is inaccurate with numbers above 44K or so. Need to figure that out.
 *
 */

import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { BigAssFans_i6Platform } from './platform';

// https://stackoverflow.com/questions/38875401/getting-error-ts2304-cannot-find-name-buffer
declare const Buffer; // this seems to ward off typescripts whining about buffer methods such as length, etc.

const ESC = 0xDB;
const START = 0xc0;
const ESC_STUFF = 0xDD;
const START_STUFF = 0xDC;

const MAXFANSPEED = 7;

const MAXMEGADEBUGLEVEL = 99;

// property table columns
const DECODEVALUEFUNCTION = 0;
const PROPERTYHANDLERFUNCTION = 1;

export class BigAssFans_i6PlatformAccessory {
  public fanService!: Service;
  public lightBulbService!: Service;
  public humiditySensorService!: Service;
  public temperatureSensorService!: Service;
  public whooshSwitchService!: Service;
  public dimToWarmSwitchService!: Service;

  // public lightOnState: boolean|undefined = undefined;
  // public brightness: number|undefined  = undefined;
  // public colorTemperature: number|undefined  = undefined;
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
  };

  public showWhooshSwitch = false;
  public whooshSwitchOn = false;
  public showDimToWarmSwitch = false;
  public dimToWarmSwitchOn = false;

  public IP: string;
  public MAC: string;
  public Name = 'naamloos';
  public SSID = 'apname';
  public Model = 'i6';

  public debugLevel = 1;

  public CurrentTemperature = 0;
  public CurrentRelativeHumidity = 0;

  public client;
  public writeQueue: Buffer[] = [];
  public lastWrite!: Buffer;
  public lastBufferFromFan!: Buffer;

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
    this.IP = accessory.context.device.ip;
    this.MAC = accessory.context.device.mac;
    if (accessory.context.device.megaDebugLevel.toLowerCase() === 'max' ||
        (accessory.context.device.megaDebugLevel as number) > MAXMEGADEBUGLEVEL) {
      this.debugLevel = MAXMEGADEBUGLEVEL;
    } else {
      this.debugLevel = this.accessory.context.device.megaDebugLevel as number;
    }
    megaDebug(this, 1, 'megaDebugLevel:' + (this.accessory.context.device.megaDebugLevel as number));

    if (accessory.context.device.whoosh) {
      this.showWhooshSwitch = true; // defaults to false in property initialization
    }
    if (accessory.context.device.dimToWarm) {
      this.showDimToWarmSwitch = true; // defaults to false in property initialization
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

    // const foo =   this.accessory.getService(this.platform.Service.Fan);
    // const bar = foo?.getCharacteristic(this.platform.Characteristic.RotationSpeed)?.setProps();
    // const bar = foo?.getCharacteristic(this.platform.Characteristic.RotationSpeed)?.props;
    // const gorp = foo?.getCharacteristic(this.platform.Characteristic.RotationSpeed)?.value;
    // console.log(bar);

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

    /**
    * open the fan's communication port, establish the data and error callbacks, send the initialization sequence  and start
    * the keepalive
    */
    commsSetup(this);

    megaDebug(this, 1, 'constructed');
  }

  /**
  * 'SET' request is issued when HomeKit wants us to change the state of an accessory.
  * 'GET' request is issued  when HomeKit wants to know the state of an accessory.
  */
  async setLightOnState(value: CharacteristicValue) {
    megaDebug(this, 1, 'Set Characteristic Light On ->' + value);
    this.lightStates.On = value as boolean;
    const b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xa0, 0x04, (this.lightStates.On ? 0x01 : 0x00), 0xc0]);
    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getLightOnState(): Promise<CharacteristicValue> {
    const isOn = this.lightStates.On;
    megaDebug(this, 1, 'Get Characteristic Light On ->' + isOn);
    // if you need to return an error to show the device as 'Not Responding' in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return isOn;
  }

  async setBrightness(value: CharacteristicValue) {
    let b: Buffer;
    if (value === 0) {
      megaDebug(this, 1, 'Set Characteristic Brightness -> ' + value);
      this.lightStates.homeShieldUp = true;
      this.lightStates.Brightness = 0;
      b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xa8, 0x04, 1, 0xc0, // this one is for the device's memory
        0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xa8, 0x04, 0, 0xc0]);  // this one is actually turn off light
    } else if (value === 100 && this.lightStates.homeShieldUp) {
      this.lightStates.homeShieldUp = false;
      this.lightStates.Brightness = 1;
      b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xa8, 0x04, 1, 0xc0]);
    } else {
      this.lightStates.homeShieldUp = false;
      megaDebug(this, 1, 'Set Characteristic Brightness -> ' + value);
      this.lightStates.Brightness = value as number;
      b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xa8, 0x04, this.lightStates.Brightness, 0xc0]);
    }

    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const brightness = (this.lightStates.Brightness === 0 ? 1 : this.lightStates.Brightness);
    megaDebug(this, 2, 'Get Characteristic Brightness ->' + brightness);
    return brightness;
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    // const temperature = (this.CurrentTemperature - 32) / 1.8; // convert to celsius
    const temperature = this.CurrentTemperature;
    if (temperature < -270 || temperature > 100) {
      this.platform.log.warn('temperature out of bounds: ', temperature);
      return 0;
    }
    megaDebug(this, 2, 'Get Characteristic CurrentTemperature ->' + temperature);
    return temperature;
  }

  async getCurrentRelativeHumidity(): Promise<CharacteristicValue> {
    const humidity = this.CurrentRelativeHumidity;
    megaDebug(this, 2, 'Get Characteristic CurrentRelativeHumidity ->' + humidity);
    return humidity;
  }

  async setFanOnState(value: CharacteristicValue) {
    megaDebug(this, 2, 'Set Characteristic Fan On ->' + value);
    this.fanStates.On = value as boolean;
    const b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xd8, 0x02, (this.fanStates.On ? 0x01 : 0x00), 0xc0]);
    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getFanOnState(): Promise<CharacteristicValue> {
    const isOn = this.fanStates.On;
    megaDebug(this, 2, 'Get Characteristic Fan On ->' + isOn);
    return isOn;
  }

  async setRotationSpeed(value: CharacteristicValue) {
    let b: Buffer;
    if (value === 0) {
      megaDebug(this, 2, 'Set Characteristic RotationSpeed -> ' + (value as number) + '%');
      this.fanStates.homeShieldUp = true;
      this.fanStates.RotationSpeed = 0;
      b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xf0, 0x02, 1, 0xc0, // this one is for the device's memory
        0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xf0, 0x02, 0, 0xc0]);  // this one will actually stop rotation
    } else if (value === 100 && this.fanStates.homeShieldUp) {
      this.fanStates.homeShieldUp = false;
      this.fanStates.RotationSpeed = 1;
      b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xf0, 0x02, 1, 0xc0]);
    } else {
      this.fanStates.homeShieldUp = false;
      megaDebug(this, 2, 'Set Characteristic RotationSpeed -> ' + (value as number) + '%');
      this.fanStates.RotationSpeed = Math.round(((value as number) / 100) * MAXFANSPEED);
      if (this.fanStates.RotationSpeed > MAXFANSPEED) {
        this.platform.log.warn('ignoring fan speed > ' + MAXFANSPEED + ': ' + this.fanStates.RotationSpeed);
      }
      b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xf0, 0x02, this.fanStates.RotationSpeed, 0xc0]);
    }
    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {  // get speed as percentage
    let rotationPercent = Math.round((this.fanStates.RotationSpeed / MAXFANSPEED) * 100);
    if (rotationPercent === 0) {
      rotationPercent = 1;
    }
    megaDebug(this, 2, 'Get Characteristic RotationSpeed ->' + rotationPercent + '%');
    return rotationPercent;
  }

  async setRotationDirection(value: CharacteristicValue) {
    megaDebug(this, 2, 'Set Characteristic RotationDirection -> ' + value);
    this.fanStates.RotationDirection = value as number;
    const b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xe0, 0x02, value, 0xc0]); // 0 is clockwise, 1 is counterclockwise
    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getRotationDirection(): Promise<CharacteristicValue> {
    const rotationDirection = this.fanStates.RotationDirection;
    megaDebug(this, 2, 'Get Characteristic RotationDirection ->' + rotationDirection);
    return rotationDirection;
  }

  // Mireds!
  async setColorTemperature(value: CharacteristicValue) {
    megaDebug(this, 2, 'Set Characteristic ColorTemperature  -> ' + value);
    this.lightStates.ColorTemperature = Math.round(1000000/(value as number));
    const bigNumberArray = stuffed(makeBigAssNumberValues(this.lightStates.ColorTemperature));
    // megaDebug(this, 2, 'bigNumberValues.length: ' + bigNumberArray.length);
    const firstPart = [0xc0, 0x12, bigNumberArray.length + 6, 0x12, bigNumberArray.length + 4, 0x1a,
      bigNumberArray.length + 2, 0xb8, 0x04];
    const b = Buffer.from(firstPart.concat(bigNumberArray, 0xc0));
    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getColorTemperature(): Promise<CharacteristicValue> {
    const colorTemperature = Math.round(1000000 / this.lightStates.ColorTemperature);
    megaDebug(this, 2, 'Get Characteristic ColorTemperature ->' + colorTemperature);
    return colorTemperature;
  }

  // set/get won't get called unless showWhooshSwitch is true
  async setWhooshSwitchOnState(value: CharacteristicValue) {
    megaDebug(this, 2, 'Set Characteristic Whoosh Switch On ->' + value);
    this.whooshSwitchOn = value as boolean;
    const b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xd0, 0x03, (this.whooshSwitchOn ? 0x01 : 0x00), 0xc0]);
    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getWhooshSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.whooshSwitchOn;
    megaDebug(this, 2, 'Get Characteristic Whoosh Switch On ->' + isOn);
    return isOn;
  }

  // set/get won't get called unless showDimToWarmSwitch is true
  async setDimToWarmSwitchOnState(value: CharacteristicValue) {
    megaDebug(this, 2, 'Set Characteristic Dim to Warm Switch On ->' + value);
    this.dimToWarmSwitchOn = value as boolean;
    const b = Buffer.from([0xc0, 0x12, 0x07, 0x12, 0x05, 0x1a, 0x03, 0xe8, 0x04, (this.dimToWarmSwitchOn ? 0x01 : 0x00), 0xc0]);
    megaDebug(this, 7, 'sending ' + b.toString('hex'));
    this.lastWrite = b;
    this.client.write(b);
  }

  async getDimToWarmSwitchOnState(): Promise<CharacteristicValue> {
    const isOn = this.dimToWarmSwitchOn;
    megaDebug(this, 2, 'Get Characteristic Dim to Warm Switch On ->' + isOn);
    return isOn;
  }

}

  import net = require('net');
/**
* connect to the fan, send an initialization message, establish the error and data callbacks and start a keep-alive interval timer.
*/
function commsSetup(platformAccessory: BigAssFans_i6PlatformAccessory) {
  const initMessage = 'c0 12 02 1a 00 c0';
  platformAccessory.client = net.connect(31415, platformAccessory.IP, () => {
    megaDebug(platformAccessory, 1, 'connected!');
    platformAccessory.client.setKeepAlive(true);
    const sa = initMessage.split(' ');
    const ha: number[] = [];
    for (let i = 0; i < sa.length; ++i) {
      ha[i] = parseInt('0x' + sa[i]);
    }
    const b = Buffer.from(ha);
    megaDebug(platformAccessory, 7, 'sending ' + b.toString('hex'));
    platformAccessory.lastWrite = b;
    platformAccessory.client.write(b);
  });

  let errHandler;

  platformAccessory.client.on('error', errHandler = (err) => {
    if (err.code === 'ECONNRESET'|| err.code === 'ECONNRESET') {
      platformAccessory.platform.log.warn('Fan network connection reset. Attempting reconnect in 2 seconds.');
    } else {
      platformAccessory.platform.log.warn('Unhandled network error: ' + err.code + '.  Attempting reconnect in 2 seconds.');
    }
    // megaDebug(platformAccessory, 3, 'lastBufferFromFan: ' + hexFormat(platformAccessory.lastBufferFromFan));
    // platform.log.debug(err);
    // megaDebug(platformAccessory, 2, 'platformAccessory.lastWrite: ' + hexFormat(platformAccessory.lastWrite));
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
  // sending the mysterious code that the vendor app seems to send once every minute didn't prevent it.
  // can try going to every 15 seconds like the vendor app seems to do.
  // perhaps I need to call socket.setKeepAlive([enable][, initialDelay]) when I establish it above?
  // obviously, I don't unerstand this stuff
  setInterval(( )=> {
    const b = Buffer.from([0xc0, 0x12, 0x04, 0x1a, 0x02, 0x08, 0x03, 0xc0]);
    platformAccessory.lastWrite = b;
    platformAccessory.client.write(b);
  }, 60000);
}

function onData(platformAccessory: BigAssFans_i6PlatformAccessory, data: Buffer) {
  megaDebug(platformAccessory, 11, 'raw data: ' + hexFormat(data));
  megaDebug(platformAccessory, 8, 'accessory client got: ' + data.length + ' bytes');

  platformAccessory.lastBufferFromFan = data;

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
    processFanMessage(platformAccessory, unstuff(platformAccessory, chunks[i]));
  }
}

function processFanMessage(platformAccessory: BigAssFans_i6PlatformAccessory, data: typeof Buffer) {
  const log = platformAccessory.platform.log;
  let len = 0;
  let propertyFields: typeof Buffer;

  const rawChunk = data;

  // new strategy - will digest the header here
  if (data[0] !== 0xc0) {
    log.warn('expected start of message chunk (0x0c), got: ' + hexFormat(data[0]));
    megaDebug(platformAccessory, 3, 'rawChunk: ' + hexFormat(rawChunk));
    return;
  }
  data = data.subarray(1); // remove 0xc0

  if (data[0] !== 0x12) {
    log.warn('expected start of message header (0x12), got: ' + hexFormat(data[0]));
    megaDebug(platformAccessory, 3, 'rawChunk: ' + hexFormat(rawChunk));
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
    megaDebug(platformAccessory, 3, 'rawChunk: ' + hexFormat(rawChunk));
    return;
  }
  if (data.length === 0 || data[0] !== 0x22) {
    log.warn('not good.  apparently we ran off the end of the data buffer');
    megaDebug(platformAccessory, 3, 'rawChunk: ' + hexFormat(rawChunk));
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

  if (data.length !== (chunkSizeSansToken + 73)) { // 73 - token lengh + 1 (0xc0)
    log.warn('chunkSizeSansToken: ' + chunkSizeSansToken + 73 + ', not what we expected with data length: ' + data.length);
    megaDebug(platformAccessory, 3, 'rawChunk: ' + hexFormat(rawChunk));
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
        megaDebug(platformAccessory, 2, 'surprise! token length was: ' + data.length);
      }
    }
    if (data[0] !== 0x12 && data[0] !== 0x1a) {
      platformAccessory.platform.log.warn('expected 0x12|0x1a, got: ', hexFormat(data.subarray(0, 1)));
      megaDebug(platformAccessory, 2, 'unexpected byte in chunk:  ' + hexFormat(data) + ' from: ' + hexFormat(rawChunk));
      return;
    }
    data = data.subarray(1);  // remove the 'start of header' (0x12) from the remaining data

    len = data[0];
    data = data.subarray(1);  // remove the 'length' byte from the remaining data

    propertyFields = data.subarray(0, len); // this is the message - property code and value
    data = data.subarray(len);  // remove the message from the remaining data

    // platformAccessory.platform.log.debug('picked off: ' +
    //  hexFormat(Buffer.from([0x12, len])) + ', ' + hexFormat(propertyFields))

    let hdrsize = 2;
    if (propertyFields[0] === 0x70 || propertyFields[0] === 0x78) { // a couple of differently formatted properties
      hdrsize = 1;
    }

    const propertyCodeString = hexFormat(propertyFields.subarray(0, hdrsize));
    const propertyValueField = propertyFields.subarray(hdrsize);

    if (platformAccessory.propertiesTable[propertyCodeString] === undefined) {
      platformAccessory.platform.log.warn('propertiesTable[[' + propertyCodeString + '] === undefined');
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
    // platformAccessory.platform.log.debug("parsedValue(" + propertyCodeType + ", " +
    //  hexFormat(propertyValue) + ", log): " + parsedValue);

    // some unknown codes are under surveillance - is this one of them?
    codeWatch(platformAccessory, propertyCodeString, parsedValue/*, propertyValueField*/);

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
  properties['0x08, 0x03'] = [dataValue,    mysteryCode],             //  something to do with schedules
  properties['0xa0, 0x04'] = [boolValue,    lightOnState];            //  light
  properties['0x0a, 0x08'] = [text3Value,   noop];                    //  name
  properties['0x12, 0x02'] = [text3Value,   noop];                    //  model
  properties['0x18, 0xc0'] = [dataValue,    mysteryCode];             //  mystery
  properties['0x22, 0x13'] = [text3Value,   noop];                    //  local datetime
  properties['0x2a, 0x14'] = [text3Value,   noop];                    //  zulu datetime
  properties['0x32, 0x3a'] = [text3Value,   noop];                    //  mystery datetime
  properties['0x3a, 0x05'] = [text3Value,   noop];                    //  mystery firmware
  properties['0x42, 0x11'] = [text3Value,   noop];                    //  MAC address
  properties['0x4a, 0x24'] = [textValue,    mysteryCode];             //  mystery
  properties['0x52, 0x24'] = [textValue,    mysteryCode];             //  mystery
  properties['0x5a, 0x12'] = [text3Value,   noop];                    //  website
  properties['0x6a, 0x01'] = [intValue,     mysteryCode];             //  mystery
  properties['0x70'] =       [intValue,     mysteryCode];             //  mystery
  properties['0x78'] =       [intValue,     mysteryCode];             //  mystery
  properties['0x80, 0x02'] = [intValue,     mysteryCode];             //  mystery
  properties['0x80, 0x03'] = [weatherValue, noop];                    //  comfort ideal temperature
  properties['0x80, 0x04'] = [intValue, mysteryCode];                 //  mystery
  properties['0x82, 0x01'] = [text4Value, noop];                      //  mystery firmware
  properties['0x88, 0x02'] = [intValue, mysteryCode];                 //  mystery
  properties['0x88, 0x03'] = [intValue, mysteryCode];                 //  mystery
  properties['0x90, 0x03'] = [intValue, noop];                        //  comfort min speed
  properties['0x98, 0x03'] = [intValue, noop];                        //  comfort max speed
  properties['0xa0, 0x03'] = [boolValue, noop];                       //  fan motion sense
  properties['0xa8, 0x03'] = [varIntValue, noop];                     //  fan motion timeout
  properties['0xa8, 0x04'] = [intValue, lightBrightness];             //  light brightness
  properties['0xa8, 0x08'] = [intValue, mysteryCode];                 //  mystery
  properties['0xb0, 0x03'] = [boolValue, noop];                       //  fan return to auto on/off
  properties['0xb0, 0x04'] = [intValue, noop];                        //  brightness as level (0,1-16)
  properties['0xb0, 0x05'] = [weatherValue, currentTemperature];      //  temperature
  properties['0xb0, 0x07'] = [intValue, mysteryCode];                 //  mystery
  properties['0xb0, 0x08'] = [boolValue, noop];                       //  LED indicators
  properties['0xb0, 0x09'] = [boolValue, noop];                       //  prevent additional controls
  properties['0xb8, 0x03'] = [varIntValue, noop];                     //  fan return to auto after
  properties['0xb8, 0x04'] = [varIntValue, lightColorTemperature];    //  color temperature
  properties['0xb8, 0x05'] = [weatherValue, currentRelativeHumidity]; //  humidity
  properties['0xb8, 0x08'] = [boolValue, noop];                       //  beeper
  properties['0xb8, 0x09'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc0, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc0, 0x04'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc0, 0x08'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc2, 0x03'] = [textValue, mysteryCode];                //  mystery
  properties['0xc2, 0x07'] = [textValue, noop];                       //  IP address
  properties['0xc2, 0x09'] = [dataValue, mysteryCode];                //  mystery MAC address with or w/o firmware versions (text6 or text7)
  properties['0xc8, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc8, 0x03'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc8, 0x04'] = [varIntValue, noop];                     //  light auto motion timeout (time)
  properties['0xc8, 0x05'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc8, 0x07'] = [intValue, mysteryCode];                 //  mystery
  properties['0xc8, 0x08'] = [intValue, mysteryCode];                 //  mystery
  properties['0xd0, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xd0, 0x03'] = [boolValue, whooshOnState];              //  whoosh
  properties['0xd0, 0x04'] = [boolValue, noop];                       //  light return to auto on/off
  properties['0xd0, 0x08'] = [intValue, mysteryCode];                 //  mystery
  properties['0xd8, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xd8, 0x02'] = [onOffAutoValue, fanOnState];            //  fan on
  properties['0xd8, 0x04'] = [varIntValue, noop];                     //  light return to auto (time)
  properties['0xda, 0x03'] = [intValue, mysteryCode];                 //  mystery
  properties['0xda, 0x0a'] = [intValue, mysteryCode];                 //  mystery
  properties['0xdb, 0xdc'] = [intValue, mysteryCode];                 //  mystery
  properties['0xe0, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xe0, 0x02'] = [boolValue, fanRotationDirection];       //  rotation direction
  properties['0xe0, 0x03'] = [boolValue, noop];                       //  comfort heat assist
  properties['0xe0, 0x08'] = [intValue, mysteryCode];                 //  mystery
  properties['0xe2, 0x04'] = [textValue, mysteryCode];                //  mystery
  properties['0xe2, 0x07'] = [text2Value, noop];                      //  SSID
  properties['0xe8, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xe8, 0x02'] = [intValue, noop];                        //  fan speed as %
  properties['0xe8, 0x03'] = [intValue, mysteryCode];                 //  mystery
  properties['0xe8, 0x04'] = [boolValue, dimToWarmOnState];           //  light dim to warm
  properties['0xf0, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xf0, 0x02'] = [intValue, fanRotationSpeed];            //  fan rotation speed
  properties['0xf0, 0x03'] = [intValue, mysteryCode];                 //  mystery
  properties['0xf0, 0x04'] = [varIntValue, mysteryCode];              //  mystery
  properties['0xf8, 0x01'] = [intValue, mysteryCode];                 //  mystery
  properties['0xf8, 0x02'] = [boolValue, noop];                       //  fan auto comfort
  properties['0xf8, 0x03'] = [intValue, noop];                        //  revolutions per minute
  properties['0xf8, 0x04'] = [varIntValue, mysteryCode];              //  mystery
  // props in sean9keenan's 'homebridge-bigAssFans createGetField not listed above - might be in the mystery category
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
  megaDebug(pA, 2, 'update ColorTemperature:' + mireds);
  pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.ColorTemperature, mireds);
}

// function lightBrightness(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
//   const log = pA.platform.log;
//   if (value !== 0) { // don't tell homebridge brightness is zero, it only confuses it.  It'll find out it's off in soon enough.
//     pA.lightStates.Brightness = (value as number);
//     log.debug('update Brightness:', pA.lightStates.Brightness);
//     pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.Brightness, pA.lightStates.Brightness);
//   }
// }
function lightBrightness(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value !== 0) { // don't tell homebridge brightness is zero, it only confuses it.  It'll find out it's off in soon enough.
    /* if (pA.lightStates.homeShieldUp && value != 1) {
      log.debug("uuunnnnnhhhh");
    } else */{
      pA.lightStates.homeShieldUp = false;
      pA.lightStates.Brightness = (value as number);
      megaDebug(pA, 2, 'update Brightness:' + pA.lightStates.Brightness);
      pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.Brightness, pA.lightStates.Brightness);
    }
  }
}

function lightOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  const onValue = (value === 0 ? false : true);
  pA.lightStates.On = onValue;
  megaDebug(pA, 2, 'update Light On:' + pA.lightStates.On);
  pA.lightBulbService.updateCharacteristic(pA.platform.Characteristic.On, pA.lightStates.On);
}

function fanOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value === 2) {  // this means the fan is in Auto mode -  we don't handle it yet
    return;
  }
  const onValue = (value === 0 ? false : true);
  pA.fanStates.On = onValue;
  megaDebug(pA, 2, 'update FanOn:' + pA.fanStates.On);
  pA.fanService.updateCharacteristic(pA.platform.Characteristic.On, pA.fanStates.On);
}

function fanRotationDirection(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  //  fan reports if 'reverse rotation' is on or off, homebridge wants rotation direction
  //  reverse switch off (0) == rotation direction counterclockwise (1)
  const rotationDirection = value === 0 ? 1 : 0;
  pA.fanStates.RotationDirection = rotationDirection;
  megaDebug(pA, 2, 'update RotationDirection:' + pA.fanStates.RotationDirection);
  pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationDirection, pA.fanStates.RotationDirection);
}

function fanRotationSpeed(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value !== 0) { // don't tell homebridge speed is zero, it only confuses it.  It'll find out it's off in due course.
    pA.fanStates.homeShieldUp = false;
    pA.fanStates.RotationSpeed = (value as number);
    megaDebug(pA, 2, 'set speed to ' + pA.fanStates.RotationSpeed);
    // convert to percentage for homekit
    const speedPercent = Math.round((pA.fanStates.RotationSpeed / MAXFANSPEED) * 100);
    megaDebug(pA, 2, 'update RotationSpeed: ' + speedPercent + '%');
    pA.fanService.updateCharacteristic(pA.platform.Characteristic.RotationSpeed, speedPercent);
  }
}

function currentTemperature(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  pA.CurrentTemperature = Number(value);
  megaDebug(pA, 2, 'update CurrentTemperature:' + pA.CurrentTemperature);
  pA.temperatureSensorService.updateCharacteristic(pA.platform.Characteristic.CurrentTemperature, pA.CurrentTemperature);
}

function currentRelativeHumidity(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (value < 0 || value > 100) {
    pA.platform.log.info('humidity out of range: ' + value + ', ignored');
    return;
  }

  pA.CurrentRelativeHumidity = Number(value);
  megaDebug(pA, 2, 'update CurrentRelativeHumidity:' + pA.CurrentRelativeHumidity);
  pA.humiditySensorService.updateCharacteristic(pA.platform.Characteristic.CurrentRelativeHumidity, pA.CurrentRelativeHumidity);
}

function whooshOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showWhooshSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.whooshSwitchOn = onValue;
    megaDebug(pA, 2, 'update Whoosh:' + pA.whooshSwitchOn);
    pA.whooshSwitchService.updateCharacteristic(pA.platform.Characteristic.On, pA.whooshSwitchOn);
  }
}

function dimToWarmOnState(value: number|string, pA:BigAssFans_i6PlatformAccessory) {
  if (pA.showDimToWarmSwitch) {
    const onValue = (value === 0 ? false : true);
    pA.dimToWarmSwitchOn = onValue;
    megaDebug(pA, 2, 'update Dim to Warm:' + pA.dimToWarmSwitchOn);
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
      megaDebug(pA, 3, 'mystery property value: ' + code + ' changed from: ' + p + ', to: ' + v);
      pA.mysteryProperties[code] = v;
    }
  } else {
    megaDebug(pA, 3, 'initial mystery property value: ' + code + ', : ' + v);
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
function codeWatch(pA:BigAssFans_i6PlatformAccessory, s: string, v: string|number|Buffer/*, m: any*/) {
  /* if (s === '0x18, 0xc0') {
    log.debug('code watch - s: ' + s + ', m: ' + hexFormat(m));
  } else */ if (s === '0xf8, 0x03') {  //  RPMs
    switch (v) {
      case 0:
      case 22:
      case 43:
      case 63:
      case 84:
      case 104:
      case 125:
      case 145:
        break;
      default:
        megaDebug(pA, 1, 'code watch - s: ' + s + ', v: ' + hexFormat(v));
    }
  }
  // if (s === '0xda, 0x0a') {
  //   megaDebug(pA, 3, 'code watch - s: ' + s + ', v: ' + hexFormat(v));
  // }
}

function unstuff(platformAccessory: BigAssFans_i6PlatformAccessory, data:typeof Buffer):typeof Buffer {
  const unstuffedData: number[] = [];
  if (data[0] !== START) {
    megaDebug(platformAccessory, 1, 'data doesn\'t begin with START byte - all bets are off');
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

// lvl 1 - constructor completed
// lvl 2 - characteristic stuff, error debugging and data exceptions
// lvl 3 - mystery values  + unknown chunks
// lvl 4 - chunk type matching
// lvl 7 - data sent to fan
// lvl 8 - byte count received from fan
// lvl 9 - show unmatched data chunks
// lvl 11 - data received from fan
function megaDebug (platformAccessory: BigAssFans_i6PlatformAccessory, level: number, message: string) {
  if (platformAccessory.debugLevel >= level) {
    platformAccessory.platform.log.debug(message);
  }
}
