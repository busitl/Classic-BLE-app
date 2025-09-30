import {
    Button,
    Dimensions,
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TouchableHighlight,
    View,
    Switch,
    Alert,
    ActivityIndicator
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useEffect, useState, useRef} from 'react';
import BleManager from 'react-native-ble-manager';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import {Buffer} from '@craftzdog/react-native-buffer';
import requestPermissions from '@/hooks/blePermissions';
import Tts from 'react-native-tts';

const {width: sWidth, height: sHeight} = Dimensions.get('screen');

// GATT标准服务UUID
const STANDARD_SERVICES = {
    '0000180f-0000-1000-8000-00805f9b34fb': 'Battery Service',
    '0000180a-0000-1000-8000-00805f9b34fb': 'Device Information',
    '00001805-0000-1000-8000-00805f9b34fb': 'Current Time Service',
    '00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
    '00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
    '0000110b-0000-1000-8000-00805f9b34fb': 'Audio Sink',
    '0000110a-0000-1000-8000-00805f9b34fb': 'Audio Source',
    '0000111e-0000-1000-8000-00805f9b34fb': 'Handsfree'
};

// GATT标准特征UUID
const STANDARD_CHARACTERISTICS = {
    '00002a19-0000-1000-8000-00805f9b34fb': 'Battery Level',
    '00002a29-0000-1000-8000-00805f9b34fb': 'Manufacturer Name',
    '00002a24-0000-1000-8000-00805f9b34fb': 'Model Number',
    '00002a25-0000-1000-8000-00805f9b34fb': 'Serial Number',
    '00002a27-0000-1000-8000-00805f9b34fb': 'Hardware Revision',
    '00002a26-0000-1000-8000-00805f9b34fb': 'Firmware Revision',
    '00002a00-0000-1000-8000-00805f9b34fb': 'Device Name',
    '00002a01-0000-1000-8000-00805f9b34fb': 'Appearance'
};

export default function EnhancedBleManagerPage() {
    const [peripherals, setPeripherals] = useState(new Map());
    const [bondedDevices, setBondedDevices] = useState([]);
    const [isConnect, setIsConnect] = useState(false);
    const [peripheralData, setPeripheralData] = useState(null);
    const [connectDevice, setConnectDevice] = useState(null);
    const [bluetoothMode, setBluetoothMode] = useState('BLE');
    const [isScanning, setIsScanning] = useState(false);
    const [autoTimeBroadcast, setAutoTimeBroadcast] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [batteryLevel, setBatteryLevel] = useState(null);
    const [deviceInfo, setDeviceInfo] = useState({});
    
    const timeBroadcastInterval = useRef(null);
    const reconnectTimeout = useRef(null);
    const connectionCheckInterval = useRef(null);

    useEffect(() => {
        initBluetooth();
        initTts();
        
        return () => {
            clearAllTimers();
            stopListeners();
        };
    }, []);

    // 自动定时播报
    useEffect(() => {
        if (autoTimeBroadcast && isConnect) {
            startTimeBroadcast();
        } else {
            stopTimeBroadcast();
        }
        
        return () => stopTimeBroadcast();
    }, [autoTimeBroadcast, isConnect]);

    // 初始化TTS
    const initTts = async () => {
        try {
            await Tts.setDefaultLanguage('zh-CN');
            await Tts.setDefaultRate(0.5);
            await Tts.setDefaultPitch(1.0);
            console.log('[DEBUG CODE] TTS初始化成功');
        } catch (err) {
            console.log('[ERROR CODE] TTS初始化失败: ', err);
        }
    };

    // 初始化蓝牙
    const initBluetooth = async () => {
        const blePermission = await requestPermissions();
        if (!blePermission) {
            Alert.alert('权限错误', '无法获取蓝牙权限');
            return;
        }

        try {
            await BleManager.enableBluetooth();
            console.log('[DEBUG CODE] 蓝牙已开启');
            
            await BleManager.start({showAlert: false});
            console.log('[DEBUG CODE] 蓝牙初始化成功');
            
            setupListeners();
        } catch (err) {
            console.log('[ERROR CODE] 蓝牙初始化错误: ', err);
            Alert.alert('错误', '蓝牙初始化失败');
        }
    };

    // 设置监听器
    const setupListeners = () => {
        BleManager.addListener('BleManagerDidUpdateState', handleBluetoothState);
        BleManager.addListener('BleManagerDiscoverPeripheral', handleDiscoverPeripheral);
        BleManager.addListener('BleManagerStopScan', handleStopScan);
        BleManager.addListener('BleManagerConnectPeripheral', handleConnectPeripheral);
        BleManager.addListener('BleManagerDisconnectPeripheral', handleDisconnectPeripheral);
        BleManager.addListener('BleManagerPeripheralDidBond', handleBondDevice);
    };

    const stopListeners = () => {
        BleManager.removeAllListeners('BleManagerDidUpdateState');
        BleManager.removeAllListeners('BleManagerDiscoverPeripheral');
        BleManager.removeAllListeners('BleManagerStopScan');
        BleManager.removeAllListeners('BleManagerConnectPeripheral');
        BleManager.removeAllListeners('BleManagerDisconnectPeripheral');
        BleManager.removeAllListeners('BleManagerPeripheralDidBond');
    };

    // 蓝牙状态监听
    const handleBluetoothState = (state) => {
        console.log('[DEBUG CODE] 蓝牙状态: ', state);
        if (state.state === 'off') {
            Alert.alert('提示', '蓝牙已关闭,请开启蓝牙');
        }
    };

    // 发现设备
    const handleDiscoverPeripheral = (peripheral) => {
        console.log('[DEBUG CODE] 发现设备: ', peripheral.name || 'Unknown');
        setPeripherals(map => {
            const newMap = new Map(map);
            newMap.set(peripheral.id, peripheral);
            return newMap;
        });
    };

    // 停止扫描
    const handleStopScan = () => {
        console.log('[DEBUG CODE] 停止扫描');
        setIsScanning(false);
    };

    // 连接设备
    const handleConnectPeripheral = (event) => {
        console.log('[DEBUG CODE] 已连接设备: ', event);
        setIsConnect(true);
        setConnectionStatus('connected');
        startConnectionMonitoring();
    };

    // 断开连接
    const handleDisconnectPeripheral = (event) => {
        console.log('[DEBUG CODE] 设备断开: ', event);
        setIsConnect(false);
        setConnectionStatus('disconnected');
        setPeripheralData(null);
        setBatteryLevel(null);
        setDeviceInfo({});
        stopConnectionMonitoring();
        
        // 提示用户并提供重连选项
        Alert.alert(
            '连接断开',
            '蓝牙设备已断开连接',
            [
                {text: '取消', style: 'cancel'},
                {text: '重新连接', onPress: () => attemptReconnect()}
            ]
        );
    };

    // 配对设备
    const handleBondDevice = (event) => {
        console.log('[DEBUG CODE] 设备配对成功: ', event);
        getBondedDevices();
    };

    // 清理所有定时器
    const clearAllTimers = () => {
        if (timeBroadcastInterval.current) {
            clearInterval(timeBroadcastInterval.current);
        }
        if (reconnectTimeout.current) {
            clearTimeout(reconnectTimeout.current);
        }
        if (connectionCheckInterval.current) {
            clearInterval(connectionCheckInterval.current);
        }
    };

    // 判断是否为音频设备
    const isAudioDevice = (device) => {
        const name = (device.name || '').toLowerCase();
        const audioKeywords = ['headphone', 'earphone', 'earbud', 'airpod', 'headset', 'buds', 'audio', '耳机', '音频'];
        return audioKeywords.some(keyword => name.includes(keyword));
    };

    // 排序设备列表,音频设备优先
    const sortDevicesByType = (devices) => {
        return devices.sort((a, b) => {
            const aIsAudio = isAudioDevice(a);
            const bIsAudio = isAudioDevice(b);
            if (aIsAudio && !bIsAudio) return -1;
            if (!aIsAudio && bIsAudio) return 1;
            return 0;
        });
    };

    // 扫描BLE设备
    const handlerScanBle = async () => {
        try {
            setPeripherals(new Map());
            setIsScanning(true);
            await BleManager.scan([], 5, false);
            console.log('[DEBUG CODE] 开始扫描BLE设备');
        } catch (err) {
            console.log('[ERROR CODE] 扫描错误: ', err);
            setIsScanning(false);
        }
    };

    // 扫描Classic蓝牙设备
    const handlerScanClassic = async () => {
        try {
            setIsScanning(true);
            console.log('[DEBUG CODE] 开始扫描Classic设备');
            
            // 1. 获取已配对的设备
            const pairedDevices = await RNBluetoothClassic.getBondedDevices();
            console.log('[DEBUG CODE] 已配对设备: ', pairedDevices.length);
            
            // 2. 扫描未配对的设备（需要先检查蓝牙是否开启）
            const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
            if (!isEnabled) {
                Alert.alert('提示', '请先开启蓝牙');
                setIsScanning(false);
                return;
            }
            
            // 开始发现设备
            const discoveredDevices = await RNBluetoothClassic.startDiscovery();
            console.log('[DEBUG CODE] 发现的设备: ', discoveredDevices.length);
            
            // 合并已配对和发现的设备
            const allDevices = [...pairedDevices, ...discoveredDevices];
            // 去重
            const uniqueDevices = allDevices.filter((device, index, self) =>
                index === self.findIndex((d) => d.address === device.address)
            );
            
            setBondedDevices(uniqueDevices);
            setIsScanning(false);
            
            console.log('[DEBUG CODE] Classic设备总数: ', uniqueDevices.length);
        } catch (err) {
            console.log('[ERROR CODE] Classic扫描错误: ', err);
            setIsScanning(false);
            Alert.alert('扫描失败', err.message || '无法扫描Classic设备');
        }
    };

    // 获取已配对设备
    const getBondedDevices = async () => {
        try {
            const devices = await RNBluetoothClassic.getBondedDevices();
            console.log('[DEBUG CODE] 已配对设备: ', devices.length);
            setBondedDevices(devices);
        } catch (err) {
            console.log('[ERROR CODE] 获取配对设备错误: ', err);
            Alert.alert('错误', '无法获取已配对设备');
        }
    };

    // 连接Classic蓝牙设备
    const handlerConnectClassicDevice = async (item) => {
        try {
            if (isConnect) {
                Alert.alert('提示', '请先断开当前连接');
                return;
            }

            setConnectionStatus('connecting');
            console.log('[DEBUG CODE] 正在连接Classic设备: ', item.name || item.address);
            
            // 使用react-native-bluetooth-classic连接
            const device = await RNBluetoothClassic.connectToDevice(item.address || item.id);
            
            if (device) {
                console.log('[DEBUG CODE] Classic设备连接成功: ', device.name);
                setIsConnect(true);
                setConnectionStatus('connected');
                setConnectDevice({
                    peripheral: device.address,
                    name: device.name,
                    device: device
                });
                
                // Classic设备使用音频协议，不需要GATT服务
                setPeripheralData([
                    {
                        service: 'classic-audio-service',
                        serviceName: 'Classic Audio Service',
                        characteristic: 'audio-stream',
                        characteristicName: 'Audio Stream',
                        properties: ['Audio'],
                        descriptors: []
                    }
                ]);
                
                // 监听断开连接
                RNBluetoothClassic.onDeviceDisconnected((disconnectedDevice) => {
                    if (disconnectedDevice.address === device.address) {
                        console.log('[DEBUG CODE] Classic设备断开: ', disconnectedDevice.name);
                        handleDisconnectPeripheral({peripheral: device.address});
                    }
                });
                
                Alert.alert('连接成功', `已连接到 ${device.name || '设备'}`);
            } else {
                throw new Error('连接失败，设备返回null');
            }
            
        } catch (err) {
            console.log('[ERROR CODE] Classic连接错误: ', err);
            setConnectionStatus('disconnected');
            setIsConnect(false);
            
            let errorMessage = '无法连接到设备';
            if (err.message) {
                errorMessage += ': ' + err.message;
            }
            
            Alert.alert(
                '连接失败', 
                `${errorMessage}\n\n提示：\n1. 确保设备已开启并处于配对模式\n2. 尝试在系统设置中先配对该设备\n3. 如果已配对，尝试忘记设备后重新配对\n4. 确保设备距离足够近`
            );
        }
    };

    // 连接BLE设备
    const handlerConnectPeripheral = async (item) => {
        try {
            if (isConnect) {
                Alert.alert('提示', '请先断开当前连接');
                return;
            }

            setConnectionStatus('connecting');
            console.log('[DEBUG CODE] 正在连接设备: ', item.name);
            
            await BleManager.connect(item.id);
            setConnectDevice({peripheral: item.id, name: item.name});
            
            // 获取服务信息
            const peripheralInfo = await BleManager.retrieveServices(item.id);
            console.log('[DEBUG CODE] 设备服务信息获取成功');
            
            // 解析GATT服务
            const parsedServices = parseGattServices(peripheralInfo);
            setPeripheralData(parsedServices);
            
            // 读取标准服务数据
            await readStandardServices(item.id, peripheralInfo);
            
        } catch (err) {
            console.log('[ERROR CODE] 连接失败: ', err);
            setConnectionStatus('disconnected');
            Alert.alert('连接失败', '无法连接到该设备');
        }
    };

    // 解析GATT服务
    const parseGattServices = (peripheralInfo) => {
        const services = [];
        
        if (peripheralInfo.characteristics) {
            peripheralInfo.characteristics.forEach(char => {
                const serviceUuid = char.service.toLowerCase();
                const charUuid = char.characteristic.toLowerCase();
                
                const serviceItem = {
                    service: serviceUuid,
                    serviceName: STANDARD_SERVICES[serviceUuid] || 'Unknown Service',
                    characteristic: charUuid,
                    characteristicName: STANDARD_CHARACTERISTICS[charUuid] || 'Unknown Characteristic',
                    properties: Object.keys(char.properties || {}),
                    descriptors: char.descriptors || []
                };
                
                services.push(serviceItem);
            });
        }
        
        return services;
    };

    // 读取标准服务数据
    const readStandardServices = async (deviceId, peripheralInfo) => {
        try {
            // 读取电池电量
            const batteryChar = peripheralInfo.characteristics?.find(
                c => c.characteristic.toLowerCase() === '00002a19-0000-1000-8000-00805f9b34fb'
            );
            
            if (batteryChar) {
                const data = await BleManager.read(
                    deviceId,
                    batteryChar.service,
                    batteryChar.characteristic
                );
                const level = Buffer.from(data)[0];
                setBatteryLevel(level);
                console.log('[DEBUG CODE] 电池电量: ', level + '%');
            }
            
            // 读取设备信息
            const infoChars = peripheralInfo.characteristics?.filter(
                c => c.service.toLowerCase() === '0000180a-0000-1000-8000-00805f9b34fb'
            );
            
            const info = {};
            for (const char of infoChars || []) {
                try {
                    const data = await BleManager.read(
                        deviceId,
                        char.service,
                        char.characteristic
                    );
                    const value = Buffer.from(data).toString('utf8');
                    const charName = STANDARD_CHARACTERISTICS[char.characteristic.toLowerCase()];
                    if (charName) {
                        info[charName] = value;
                    }
                } catch (e) {
                    // 某些特征可能无法读取
                }
            }
            
            setDeviceInfo(info);
            console.log('[DEBUG CODE] 设备信息: ', info);
            
        } catch (err) {
            console.log('[ERROR CODE] 读取标准服务失败: ', err);
        }
    };

    // 连接监控
    const startConnectionMonitoring = () => {
        connectionCheckInterval.current = setInterval(async () => {
            if (connectDevice) {
                try {
                    const isConnected = await BleManager.isPeripheralConnected(connectDevice.peripheral, []);
                    if (!isConnected) {
                        console.log('[DEBUG CODE] 检测到连接丢失');
                        handleDisconnectPeripheral({peripheral: connectDevice.peripheral});
                    }
                } catch (err) {
                    console.log('[ERROR CODE] 连接检查失败: ', err);
                }
            }
        }, 3000); // 每3秒检查一次
    };

    const stopConnectionMonitoring = () => {
        if (connectionCheckInterval.current) {
            clearInterval(connectionCheckInterval.current);
            connectionCheckInterval.current = null;
        }
    };

    // 尝试重连
    const attemptReconnect = async () => {
        if (!connectDevice) return;
        
        try {
            setConnectionStatus('reconnecting');
            await BleManager.connect(connectDevice.peripheral);
            console.log('[DEBUG CODE] 重连成功');
        } catch (err) {
            console.log('[ERROR CODE] 重连失败: ', err);
            Alert.alert('重连失败', '无法重新连接设备');
            setConnectionStatus('disconnected');
        }
    };

    // 获取当前时间文本
    const getCurrentTimeText = (prefix = '') => {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        
        const period = hours >= 12 ? '下午' : '上午';
        const hour12 = hours % 12 || 12;
        const minText = minutes < 10 ? `零${minutes}` : minutes;
        
        return `${prefix}${period}${hour12}点${minText}分`;
    };

    // 播报时间
    const broadcastTime = async (prefix = '') => {
        try {
            const timeText = getCurrentTimeText(prefix);
            console.log('[DEBUG CODE] 播报: ', timeText);
            await Tts.speak(timeText);
        } catch (err) {
            console.log('[ERROR CODE] TTS播报失败: ', err);
            Alert.alert('播报失败', '语音播报功能出错');
        }
    };

    // 手动播报时间
    const handleManualBroadcast = () => {
        if (!isConnect) {
            Alert.alert('提示', '请先连接蓝牙耳机');
            return;
        }
        broadcastTime('按钮触发播报：');
    };

    // 开始定时播报
    const startTimeBroadcast = () => {
        if (timeBroadcastInterval.current) {
            clearInterval(timeBroadcastInterval.current);
        }
        
        timeBroadcastInterval.current = setInterval(() => {
            broadcastTime('定时播报：');
        }, 30000); // 30秒
        
        console.log('[DEBUG CODE] 定时播报已启动');
    };

    // 停止定时播报
    const stopTimeBroadcast = () => {
        if (timeBroadcastInterval.current) {
            clearInterval(timeBroadcastInterval.current);
            timeBroadcastInterval.current = null;
            console.log('[DEBUG CODE] 定时播报已停止');
        }
    };

    // 断开连接
    const handleDisconnect = async () => {
        if (connectDevice) {
            try {
                if (bluetoothMode === 'Classic' && connectDevice.device) {
                    // Classic蓝牙断开
                    await RNBluetoothClassic.disconnectFromDevice(connectDevice.peripheral);
                    console.log('[DEBUG CODE] Classic设备主动断开连接');
                } else {
                    // BLE断开
                    await BleManager.disconnect(connectDevice.peripheral);
                    console.log('[DEBUG CODE] BLE设备主动断开连接');
                }
            } catch (err) {
                console.log('[ERROR CODE] 断开连接失败: ', err);
            }
        }
    };

    // 渲染连接状态
    const renderConnectionStatus = () => {
        let statusText = '';
        let statusColor = '#666';
        
        switch (connectionStatus) {
            case 'connected':
                statusText = '已连接';
                statusColor = '#4CAF50';
                break;
            case 'connecting':
                statusText = '连接中...';
                statusColor = '#FF9800';
                break;
            case 'reconnecting':
                statusText = '重连中...';
                statusColor = '#FF9800';
                break;
            case 'disconnected':
                statusText = '未连接';
                statusColor = '#F44336';
                break;
        }
        
        return (
            <View style={styles.statusContainer}>
                <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
                <Text style={[styles.statusText, {color: statusColor}]}>{statusText}</Text>
            </View>
        );
    };

    // 渲染设备项
    const renderBleItem = ({item}) => {
        const isAudio = isAudioDevice(item);
        return (
            <TouchableHighlight 
                style={[
                    styles.deviceItem,
                    {backgroundColor: isAudio ? '#E3F2FD' : '#F5F5F5'}
                ]} 
                onPress={() => handlerConnectPeripheral(item)}
                underlayColor="#BBDEFB"
            >
                <View>
                    <View style={styles.deviceHeader}>
                        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
                        {isAudio && <Text style={styles.audioBadge}>🎧 音频</Text>}
                    </View>
                    <Text style={styles.deviceId}>{item.id}</Text>
                    {item.rssi && <Text style={styles.rssi}>信号: {item.rssi} dBm</Text>}
                </View>
            </TouchableHighlight>
        );
    };

    // 渲染已配对设备项
    const renderClassicItem = ({item}) => {
        const isAudio = isAudioDevice(item);
        return (
            <TouchableHighlight 
                style={[
                    styles.deviceItem,
                    {backgroundColor: isAudio ? '#FFF3E0' : '#F5F5F5'}
                ]} 
                onPress={() => handlerConnectClassicDevice(item)}
                underlayColor="#FFE0B2"
            >
                <View>
                    <View style={styles.deviceHeader}>
                        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
                        {isAudio && <Text style={styles.audioBadge}>🎧 音频</Text>}
                    </View>
                    <Text style={styles.deviceId}>{item.address || item.id}</Text>
                    {item.bonded && <Text style={styles.bondedTag}>✓ 已配对</Text>}
                </View>
            </TouchableHighlight>
        );
    };

    // 渲染GATT服务项
    const renderServiceItem = ({item, index}) => {
        return (
            <View style={styles.serviceItem} key={index}>
                <Text style={styles.serviceName}>{item.serviceName}</Text>
                <Text style={styles.serviceUuid}>{item.service}</Text>
                
                <Text style={styles.charName}>{item.characteristicName}</Text>
                <Text style={styles.charUuid}>{item.characteristic}</Text>
                
                <View style={styles.propertiesContainer}>
                    {item.properties.map((prop, i) => (
                        <Button
                            key={i}
                            title={prop}
                            onPress={() => handleService(item, prop)}
                        />
                    ))}
                </View>
                
                {item.descriptors.length > 0 && (
                    <Text style={styles.descriptorText}>
                        描述符: {item.descriptors.length}个
                    </Text>
                )}
            </View>
        );
    };

    // 处理服务操作
    const handleService = async (item, operation) => {
        if (!connectDevice) return;
        
        const deviceId = connectDevice.peripheral;
        const {characteristic, service} = item;
        
        try {
            switch (operation) {
                case 'Read':
                    const data = await BleManager.read(deviceId, service, characteristic);
                    const buffer = Buffer.from(data);
                    console.log('[DEBUG CODE] 读取数据: ', buffer.toString('hex'));
                    Alert.alert('读取成功', `数据: ${buffer.toString('hex')}`);
                    break;
                    
                case 'Write':
                    const writeData = Buffer.from('Hello BLE');
                    await BleManager.write(deviceId, service, characteristic, writeData.toJSON().data);
                    console.log('[DEBUG CODE] 写入成功');
                    Alert.alert('写入成功');
                    break;
                    
                case 'Notify':
                    await BleManager.startNotification(deviceId, service, characteristic);
                    console.log('[DEBUG CODE] 通知已启用');
                    Alert.alert('通知已启用');
                    break;
            }
        } catch (err) {
            console.log('[ERROR CODE] 操作失败: ', err);
            Alert.alert('操作失败', err.message);
        }
    };

    const sortedPeripherals = sortDevicesByType(Array.from(peripherals.values()));
    const sortedBondedDevices = sortDevicesByType(bondedDevices);

    return (
        <View style={[styles.container, {marginTop: useSafeAreaInsets().top}]}>
            <View style={styles.header}>
                <Text style={styles.title}>蓝牙耳机管理器</Text>
                {renderConnectionStatus()}
            </View>
            
            {!isConnect ? (
                <>
                    <View style={styles.modeSelector}>
                        <TouchableHighlight
                            style={[
                                styles.modeButton,
                                bluetoothMode === 'BLE' && styles.modeButtonActive
                            ]}
                            onPress={() => {
                                setBluetoothMode('BLE');
                                setPeripherals(new Map());
                                setBondedDevices([]);
                            }}
                            underlayColor="#E3F2FD"
                        >
                            <Text style={[
                                styles.modeButtonText,
                                bluetoothMode === 'BLE' && styles.modeButtonTextActive
                            ]}>
                                BLE设备
                            </Text>
                        </TouchableHighlight>
                        
                        <TouchableHighlight
                            style={[
                                styles.modeButton,
                                bluetoothMode === 'Classic' && styles.modeButtonActive
                            ]}
                            onPress={() => {
                                setBluetoothMode('Classic');
                                setPeripherals(new Map());
                                setBondedDevices([]);
                            }}
                            underlayColor="#FFF3E0"
                        >
                            <Text style={[
                                styles.modeButtonText,
                                bluetoothMode === 'Classic' && styles.modeButtonTextActive
                            ]}>
                                Classic设备
                            </Text>
                        </TouchableHighlight>
                    </View>
                    
                    <View style={styles.controlPanel}>
                        <Button 
                            title={bluetoothMode === 'BLE' 
                                ? (isScanning ? '扫描BLE中...' : '扫描BLE设备') 
                                : (isScanning ? '扫描Classic中...' : '扫描Classic设备')
                            } 
                            onPress={bluetoothMode === 'BLE' ? handlerScanBle : handlerScanClassic}
                            disabled={isScanning}
                            color={bluetoothMode === 'BLE' ? '#2196F3' : '#FF9800'}
                        />
                    </View>
                    
                    {isScanning && (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color={bluetoothMode === 'BLE' ? '#2196F3' : '#FF9800'} />
                            <Text style={styles.loadingText}>
                                {bluetoothMode === 'BLE' ? '正在扫描BLE设备...' : '正在扫描Classic设备...'}
                            </Text>
                        </View>
                    )}
                    
                    <FlatList
                        style={styles.deviceList}
                        data={bluetoothMode === 'BLE' ? sortedPeripherals : sortedBondedDevices}
                        renderItem={bluetoothMode === 'BLE' ? renderBleItem : renderClassicItem}
                        keyExtractor={(item) => item.address || item.id}
                        ListEmptyComponent={
                            <Text style={styles.emptyText}>
                                {bluetoothMode === 'BLE' 
                                    ? (isScanning ? '扫描BLE中...' : '点击按钮扫描BLE设备') 
                                    : (isScanning ? '扫描Classic中...' : '点击按钮扫描Classic设备')
                                }
                            </Text>
                        }
                    />
                </>
            ) : (
                <>
                    <View style={styles.connectedInfo}>
                        <Text style={styles.connectedDevice}>
                            已连接: {connectDevice?.name || '未知设备'}
                        </Text>
                        {batteryLevel !== null && (
                            <Text style={styles.batteryText}>🔋 电量: {batteryLevel}%</Text>
                        )}
                        {Object.keys(deviceInfo).length > 0 && (
                            <View style={styles.deviceInfoContainer}>
                                {Object.entries(deviceInfo).map(([key, value]) => (
                                    <Text key={key} style={styles.infoText}>
                                        {key}: {value}
                                    </Text>
                                ))}
                            </View>
                        )}
                    </View>
                    
                    <View style={styles.controlPanel}>
                        <TouchableHighlight
                            style={styles.broadcastButton}
                            onPress={handleManualBroadcast}
                            underlayColor="#1976D2"
                        >
                            <View style={styles.broadcastButtonContent}>
                                <Text style={styles.broadcastButtonIcon}>🔊</Text>
                                <Text style={styles.broadcastButtonText}>播报当前时间</Text>
                            </View>
                        </TouchableHighlight>
                        
                        <TouchableHighlight
                            style={[
                                styles.timeBroadcastToggle,
                                autoTimeBroadcast && styles.timeBroadcastToggleActive
                            ]}
                            onPress={() => setAutoTimeBroadcast(!autoTimeBroadcast)}
                            underlayColor={autoTimeBroadcast ? "#388E3C" : "#E0E0E0"}
                        >
                            <View style={styles.toggleContent}>
                                <View style={styles.toggleLeft}>
                                    <Text style={[
                                        styles.toggleIcon,
                                        autoTimeBroadcast && styles.toggleIconActive
                                    ]}>
                                        ⏰
                                    </Text>
                                    <View>
                                        <Text style={[
                                            styles.toggleTitle,
                                            autoTimeBroadcast && styles.toggleTitleActive
                                        ]}>
                                            定时播报
                                        </Text>
                                        <Text style={[
                                            styles.toggleSubtitle,
                                            autoTimeBroadcast && styles.toggleSubtitleActive
                                        ]}>
                                            每30秒自动播报时间
                                        </Text>
                                    </View>
                                </View>
                                <View style={[
                                    styles.toggleSwitch,
                                    autoTimeBroadcast && styles.toggleSwitchActive
                                ]}>
                                    <View style={[
                                        styles.toggleSwitchThumb,
                                        autoTimeBroadcast && styles.toggleSwitchThumbActive
                                    ]} />
                                </View>
                            </View>
                        </TouchableHighlight>
                        
                        <Button 
                            title="断开连接" 
                            onPress={handleDisconnect}
                            color="#F44336"
                        />
                    </View>
                    
                    <Text style={styles.sectionTitle}>GATT服务列表</Text>
                    <FlatList
                        style={styles.serviceList}
                        data={peripheralData}
                        renderItem={renderServiceItem}
                        keyExtractor={(item, index) => index.toString()}
                    />
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FAFAFA'
    },
    header: {
        padding: 16,
        backgroundColor: '#2196F3',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#FFF'
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center'
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 6
    },
    statusText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFF'
    },
    controlPanel: {
        padding: 16,
        gap: 12
    },
    broadcastButton: {
        backgroundColor: '#2196F3',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 20,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84
    },
    broadcastButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12
    },
    broadcastButtonIcon: {
        fontSize: 24
    },
    broadcastButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold'
    },
    timeBroadcastToggle: {
        backgroundColor: '#F5F5F5',
        borderRadius: 12,
        padding: 16,
        borderWidth: 2,
        borderColor: '#E0E0E0'
    },
    timeBroadcastToggleActive: {
        backgroundColor: '#E8F5E9',
        borderColor: '#4CAF50'
    },
    toggleContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    toggleLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1
    },
    toggleIcon: {
        fontSize: 28,
        opacity: 0.6
    },
    toggleIconActive: {
        opacity: 1
    },
    toggleTitle: {
        fontSize: 17,
        fontWeight: 'bold',
        color: '#212121',
        marginBottom: 2
    },
    toggleTitleActive: {
        color: '#2E7D32'
    },
    toggleSubtitle: {
        fontSize: 13,
        color: '#757575'
    },
    toggleSubtitleActive: {
        color: '#388E3C'
    },
    toggleSwitch: {
        width: 50,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#BDBDBD',
        padding: 2,
        justifyContent: 'center'
    },
    toggleSwitchActive: {
        backgroundColor: '#4CAF50'
    },
    toggleSwitchThumb: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#FFF',
        elevation: 2
    },
    toggleSwitchThumbActive: {
        alignSelf: 'flex-end'
    },
    switchContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8
    },
    switchLabel: {
        fontSize: 16,
        fontWeight: '500'
    },
    loadingContainer: {
        padding: 20,
        alignItems: 'center'
    },
    loadingText: {
        marginTop: 10,
        color: '#666'
    },
    deviceList: {
        flex: 1
    },
    deviceItem: {
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 12,
        borderRadius: 8,
        elevation: 2
    },
    deviceHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4
    },
    deviceName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#212121',
        flex: 1
    },
    audioBadge: {
        fontSize: 12,
        color: '#2196F3',
        fontWeight: '600'
    },
    deviceId: {
        fontSize: 12,
        color: '#757575',
        marginTop: 4
    },
    rssi: {
        fontSize: 11,
        color: '#9E9E9E',
        marginTop: 2
    },
    bondedTag: {
        fontSize: 11,
        color: '#FF9800',
        marginTop: 4
    },
    emptyText: {
        textAlign: 'center',
        padding: 20,
        color: '#999',
        fontSize: 14
    },
    connectedInfo: {
        padding: 16,
        backgroundColor: '#E8F5E9',
        borderBottomWidth: 1,
        borderBottomColor: '#C8E6C9'
    },
    connectedDevice: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#2E7D32'
    },})