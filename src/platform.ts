import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { BigAssFans_i6PlatformAccessory } from './platformAccessory';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class BigAssFans_i6Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // client: any;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.initDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  initDevices() {
    this.log.info('Init - initializing devices');


    // read from config.fans
    if (this.config.fans && Array.isArray(this.config.fans)) {
      for (const fan of this.config.fans) {
        if (fan) {
          i6FanSetUp(this, fan);
        }
      }
    } else if (this.config.fans) {
      this.log.info('The fans property is not of type array. Cannot initialize. Type: %s', typeof this.config.fans);
    }

    if (!this.config.fans) {
      this.log.info('-------------------------------------------');
      this.log.info('Init - no fan configuration found');
      this.log.info('Missing fans in your platform config');
      this.log.info('-------------------------------------------');
    }

    function i6FanSetUp(platform: BigAssFans_i6Platform, fan) {
      // check if we have mandatory device info
      try {
        if (!fan.name) {
          throw new Error('"name" is required but not defined!');
        }
        if (!fan.ip) {
          throw new Error('"ip" is required but not defined for ${fan.name}!');
        }
        if (!fan.mac) {
          throw new Error('"mac" is required but not defined for ${fan.name}!');
        }
      } catch (error) {
        platform.log.error(error);
        platform.log.error('Failed to create platform device, missing mandatory information!');
        platform.log.error('Please check your device config!');
        return;
      }

      checkDevice(platform, fan.ip, (client, data: Buffer) => {
        if (data[0] !== 0xc0) {
          return;
        }
        // generate a unique id for the accessory this should be generated from
        // something globally unique, but constant, for example, the device serial
        // number or MAC address
        const uuid = platform.api.hap.uuid.generate(fan.mac);

        // see if an accessory with the same uuid has already been registered and restored from
        // the cached devices we stored in the `configureAccessory` method above
        const existingAccessory = platform.accessories.find(accessory => accessory.UUID === uuid);
        // for debugging, uncomment the following and comment out the line above to remove the accessory from cache.
        // let existingAccessory = platform.accessories.find(accessory => accessory.UUID === uuid);
        // if (existingAccessory) {
        //   platform.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        //   platform.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        //   existingAccessory = platform.accessories.find(accessory => accessory.UUID === uuid);
        // }

        if (existingAccessory) {
          // the accessory already exists
          platform.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
          // existingAccessory.context.device = device;
          // this.api.updatePlatformAccessories([existingAccessory]);
          if (existingAccessory.context.device !== fan) {
            existingAccessory.context.device = fan;
            platform.api.updatePlatformAccessories([existingAccessory]);
          }

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          new BigAssFans_i6PlatformAccessory(platform, existingAccessory);

          // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
          // remove platform accessories when no longer present
          // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        } else {
          // the accessory does not yet exist, so we need to create it
          platform.log.info('Adding new accessory:', fan.name);

          // create a new accessory
          const accessory = new platform.api.platformAccessory(fan.name, uuid);

          // store a copy of the device object in the `accessory.context`
          // the `context` property can be used to store any data about the accessory you may need
          accessory.context.device = fan;

          // create the accessory handler for the newly create accessory
          // this is imported from `platformAccessory.ts`
          new BigAssFans_i6PlatformAccessory(platform, accessory);

          // link the accessory to your platform
          platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      });
    }
  }
}

import net = require('net');
let timeoutID: NodeJS.Timeout;
function checkDevice(platform: BigAssFans_i6Platform, ip: string, cb) {
  const client = net.connect(31415, ip, () => {
    const b = Buffer.from([0xc0, 0x12, 0x02, 0x1a, 0x00, 0xc0]);
    client.write(b);

    timeoutID = setTimeout((log: Logger, ip: string, client) => {
      client.destroy();
      log.error('Fan configured with ip: ' + ip +
          ' is not responding to our probe.  This could happen if the fan model is not i6, but for instance Haiku.');
    }, 30000, platform.log, ip, client);

  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on('error', (err:any) => {
    clearTimeout(timeoutID);
    const log = platform.log;
    if (err.code === 'ETIMEDOUT') {
      log.error('Connection to fan configured with ip: ' + ip +
        ' timed out [ETIMEDOUT].  Check your fan has power, and the correct IP address in json.config.');
    } else if (err.code === 'ECONNREFUSED') {
      log.error('Connection to fan configured with ip: ' + ip +
        ' refused [ECONNREFUSED].  Check the correct IP is in json.config.');
    } else if (err.code === 'ENETUNREACH') {
      log.error('Fan configured with ip: ' + ip +
        ' is unreachable [ENETUNREACH].  Check the correct IP is in json.config.');
    } else {
      log.error(err + ' - Connection to fan configured with ip: ' + ip +
        ' raised an unhandled error [' + err.code + '].  Check the correct IP address is in json.config.');
    }
  });

  client.on('data', (data: Buffer) => {
    clearTimeout(timeoutID);
    client.destroy();
    if (data[0] === 0xc0 && data[1] === 0x12) {
      cb(client, data);
    } else {
      cb(client, Buffer.from([0x00]));
    }
  });
}
