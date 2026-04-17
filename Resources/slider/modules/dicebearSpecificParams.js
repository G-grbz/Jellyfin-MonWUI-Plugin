import { getConfig } from "./config.js";
import { createCheckbox, createSection, createNumberInput, createTextInput, createSelect } from "./settings/shared.js";
import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';
import { clearAvatarCache, cleanAvatars, updateHeaderUserAvatar } from "./userAvatar.js";
import { applyRawConfig, applySettings } from './settings/applySettings.js';

    const config = getConfig();
    const currentLang = config.defaultLanguage || getDefaultLanguage();
    const labels = getLanguageLabels(currentLang) || {};

export function addStyleSpecificParams(params, style) {
  const randomBoolean = () => Math.random() > 0.5;
  const randomOption = (options) => options[Math.floor(Math.random() * options.length)];

  switch(style) {
    case 'adventurer':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());
      params.append('earrings', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06']));

      params.append('earringsProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('glasses', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05']));

      params.append('glassesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('hair', randomOption(['long01', 'long02', 'long03', 'long04', 'long05', 'long06', 'long07', 'long08', 'long09', 'long10', 'long11', 'long12', 'long13', 'long14', 'long15', 'long17', 'long18', 'long19', 'long20', 'long21', 'long22', 'long23', 'long24', 'long25', 'long26', 'short01', 'short02', 'short03', 'short04', 'short05', 'short06', 'short07', 'short08', 'short09', 'short10', 'short11', 'short12', 'short13', 'short14', 'short15', 'short16', 'short17', 'short18', 'short19']));

      params.append('hairColor', randomOption(['0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3']));

      params.append('hairProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('skinColor', randomOption(['9e5622', '763900', 'ecad80', 'f2d3b1']));

      params.append('mouth', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30']));

      params.append('eyebrows', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15']));

      params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26']));

      params.append('features', randomOption(['birthmark', 'blush', 'freckles', 'mustache']));

      params.append('featuresProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      break;


    case 'adventurer-neutral':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());
      params.append('eyebrows', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15']));

      params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26']));

      params.append('glasses', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05']));

      params.append('glassesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('mouth', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30']));
      break;

    case 'avataaars':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());
      params.append('accessories', randomOption(['eyepatch', 'kurt', 'prescription01', 'prescription02', 'round', 'sunglasses', 'wayfarers']));

      params.append('accessoriesColor', randomOption(['3c4f5c', '65c9ff', '262e33', '5199e4', '25557c', '929598', 'a7ffc4', 'b1e2ff', 'e6e6e6', 'ff5c5c', 'ff488e', 'ffafb9', 'ffdeb5', 'ffffb1', 'ffffff']));

      params.append('accessoriesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('clothesColor', randomOption(['3c4f5c', '65c9ff', '262e33', '5199e4', '25557c', '929598', 'a7ffc4', 'b1e2ff', 'e6e6e6', 'ff5c5c', 'ff488e', 'ffafb9', 'ffffb1', 'ffffff']));

      params.append('clothing', randomOption(['blazerAndShirt', 'blazerAndSweater', 'collarAndSweater', 'graphicShirt', 'hoodie', 'overall', 'shirtCrewNeck', 'shirtScoopNeck', 'shirtVNeck']));

      params.append('clothingGraphic', randomOption(['bat', 'bear', 'cumbia', 'deer', 'diamond', 'hola', 'pizza', 'resist', 'skull', 'skullOutline']));

      params.append('eyebrows', randomOption(['angry', 'angryNatural', 'default', 'defaultNatural', 'flatNatural', 'frownNatural', 'raisedExcited', 'raisedExcitedNatural', 'sadConcerned', 'sadConcernedNatural', 'unibrowNatural', 'upDown', 'upDownNatural']));

      params.append('eyes', randomOption(['closed', 'cry', 'default', 'default', 'eyeRoll', 'happy', 'hearts', 'side', 'squint', 'surprised', 'wink', 'winkWacky', 'xDizzy']));

      params.append('facialHair', randomOption(['beardLight', 'beardMajestic', 'beardMedium', 'moustacheFancy', 'moustacheMagnum']));

      params.append('facialHairColor', randomOption(['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'c93305', 'd6b370', 'e8e1e1', 'ecdcbf', 'f59797']));

      params.append('facialHairProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('hairColor', randomOption(['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'c93305', 'd6b370', 'e8e1e1', 'ecdcbf', 'f59797']));

      params.append('hatColor', randomOption(['3c4f5c', '65c9ff', '262e33', '5199e4', '25557c', '929598', 'a7ffc4', 'b1e2ff', 'e6e6e6', 'ff5c5c', 'ff488e', 'ffafb9', 'ffdeb5', 'ffffb1', 'ffffff']));

      params.append('mouth', randomOption(['concerned', 'default', 'disbelief', 'eating', 'grimace', 'sad', 'screamOpen', 'serious', 'smile', 'tongue', 'twinkle', 'vomit']));

      params.append('skinColor', randomOption(['614335', 'ae5d29', 'd08b5b', 'edb98a', 'f8d25c', 'fd9841', 'ffdbb4']));

      params.append('top', randomOption(['bigHair', 'bob', 'bun', 'curly', 'curvy', 'dreads', 'dreads01', 'dreads02' , 'frida', 'frizzle', 'fro', 'froBand', 'hat', 'hijab', 'longButNotTooLong', 'miaWallace', 'shaggy', 'shaggyMullet', 'shavedSides', 'shortCurly', 'shortFlat', 'shortRound', 'shortWaved', 'sides', 'straight01', 'straight02', 'straightAndStrand', 'theCaesar', 'theCaesarAndSidePart', 'turban', 'winterHat1', 'winterHat02', 'winterHat03', 'winterHat04']));

      params.append('topProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));
      break;

    case 'avataaars-neutral':

      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

      params.append('eyebrows', randomOption(['angry', 'angryNatural', 'default', 'defaultNatural', 'flatNatural', 'frownNatural', 'raisedExcited', 'raisedExcitedNatural', 'sadConcerned', 'sadConcernedNatural', 'unibrowNatural', 'upDown', 'upDownNatural']));

      params.append('eyes', randomOption(['closed', 'cry', 'default', 'default', 'eyeRoll', 'happy', 'hearts', 'side', 'squint', 'surprised', 'wink', 'winkWacky', 'xDizzy']));

      params.append('mouth', randomOption(['concerned', 'default', 'disbelief', 'eating', 'grimace', 'sad', 'screamOpen', 'serious', 'smile', 'tongue', 'twinkle', 'vomit']));

      break;

    case 'big-ears':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

      params.append('cheek', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06']));

      params.append('cheekProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('ear', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08']));

      params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32']));

      params.append('face', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10']));

      params.append('frontHair', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12']));

      params.append('hair', randomOption(['long01', 'long02', 'long03', 'long04', 'long05', 'long06', 'long07', 'long08', 'long09', 'long10', 'long11', 'long12', 'long13', 'long14', 'long15', 'long17', 'long18', 'long19', 'long20', 'short01', 'short02', 'short03', 'short04', 'short05', 'short06', 'short07', 'short08', 'short09', 'short10', 'short11', 'short12', 'short13', 'short14', 'short15', 'short16', 'short17', 'short18', 'short19', 'short20']));

      params.append('hairColor', randomOption(['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'c93305', 'd6b370', 'e8e1e1', 'ecdcbf', 'f59797']));

      params.append('mouth', randomOption(['variant0101', 'variant0102', 'variant0103', 'variant0104', 'variant0105', 'variant0201', 'variant0202', 'variant0203', 'variant0204', 'variant0205', 'variant0301', 'variant0302', 'variant0303', 'variant0304', 'variant0305', 'variant0401', 'variant0402', 'variant0403', 'variant0404', 'variant0405', 'variant0501', 'variant0502', 'variant0503', 'variant0504', 'variant0505', 'variant0601', 'variant0602', 'variant0603', 'variant0604', 'variant0605', 'variant0701', 'variant0702', 'variant0703', 'variant0704', 'variant0705', 'variant0706', 'variant0707', 'variant0708']));

      params.append('nose', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12']));

      params.append('sideburn', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07']));

      params.append('skinColor', randomOption(['89532c', 'a66637', 'c07f50', 'da9969', 'f8b788']));
      break;

    case 'big-ears-neutral':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

      params.append('cheek', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06']));

      params.append('cheekProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32']));

      params.append('mouth', randomOption(['variant0101', 'variant0102', 'variant0103', 'variant0104', 'variant0105', 'variant0201', 'variant0202', 'variant0203', 'variant0204', 'variant0205', 'variant0301', 'variant0302', 'variant0303', 'variant0304', 'variant0305', 'variant0401', 'variant0402', 'variant0403', 'variant0404', 'variant0405', 'variant0501', 'variant0502', 'variant0503', 'variant0504', 'variant0505', 'variant0601', 'variant0602', 'variant0603', 'variant0604', 'variant0605', 'variant0701', 'variant0702', 'variant0703', 'variant0704', 'variant0705', 'variant0706', 'variant0707', 'variant0708']));

      params.append('nose', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12']));

      break;

    case 'big-smile':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

      params.append('accessories', randomOption(['catEars', "clownNose", "faceMask", "glasses", "mustache", "sailormoonCrown", "sleepMask", "sunglasses"]));

      params.append('accessoriesProbability', randomOption(['50', '60', '70', '80', '90', '100']));

      params.append('eyes', randomOption(['angry', 'cheery', 'confused', 'normal', 'sad', 'sleepy', 'starstruck', 'winking']));

      params.append('hair', randomOption(['bangs', 'bowlCutHair', 'braids', 'bunHair', 'curlyBob', 'curlyShortHair', 'froBun', 'halfShavedHead', 'mohawk', 'shavedHead', 'shortHair', 'straightHair', 'wavyBob']));

      params.append('hairColor', randomOption(['3a1a00', '220f00', '238d80', '605de4', '71472d', 'd56c0c', 'e2ba87', 'e9b729']));

      params.append('mouth', randomOption(['awkwardSmile', 'braces', 'gapSmile', 'kawaii', 'openedSmile', 'openSad', 'teethSmile', 'unimpressed']));

      params.append('skinColor', randomOption(['8c5a2b', '643d19', 'a47539', 'c99c62', 'e2ba87', 'efcc9f', 'f5d7b1', 'ffe4c0']));
      break;

    case 'bottts':
    case 'bottts-neutral':
      params.append('seed', randomOption(['Felix', 'Aneka']));

      params.append('baseColor', randomOption(['00acc1', '1e88e5', '5e35b1', '6d4c41', '7cb342', '8e24aa', '039be5', '43a047', '546e7a', '00897b', '3949ab', '757575', 'c0ca33', 'd81b60', 'e53935', 'f4511e', 'fb8c00', 'fdd835', 'ffb300']));

      params.append('eyes', randomOption(['bulging', 'dizzy', 'eva', 'frame1', 'frame2', 'glow', 'happy', 'hearts', 'robocop', 'round', 'roundFrame01', 'roundFrame02', 'sensor', 'shade01']));

      params.append('face', randomOption(['square01', 'square02', 'square03', 'square04', 'round01', 'round02']));

      params.append('mouth', randomOption(['bite', 'diagram', 'grill01', 'grill02', 'grill03', 'smile01', 'smile02', 'square01', 'square02']));

      params.append('mouthProbability', randomOption(['50', '60', '70', '80', '90', '100']));

      params.append('sides', randomOption(['antenna01', 'antenna02', 'cables01', 'cables02', 'round', 'square', 'squareAssymetric']));

      params.append('sidesProbability', randomOption(['50', '60', '70', '80', '90', '100']));

      params.append('texture', randomOption(['camo01', 'camo02', 'circuits', 'dirty01', 'dirty02', 'dots', 'grunge01', 'grunge02']));

      params.append('textureProbability', randomOption(['50', '60', '70', '80', '90', '100']));

      params.append('top', randomOption(['antenna', 'antennaCrooked', 'bulb01', 'glowingBulb01', 'glowingBulb02', 'horns', 'lights', 'pyramid', 'radar']));

      params.append('topProbability', randomOption(['50', '60', '70', '80', '90', '100']));
      break;

    case 'croodles':
    case 'croodles-neutral':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

      params.append('beard', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05']));

      params.append('beardProbability', randomOption(['20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16']));

      params.append('face', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08']));

      params.append('mouth', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18']));

      params.append('mustache', randomOption(['variant01', 'variant02', 'variant03', 'variant04']));

      params.append('mustacheProbability', randomOption(['20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('nose', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09']));

      params.append('top', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29']));

      params.append('topColor', randomOption(['000000', '0fa958', '699bf7', '9747ff', 'f24e1e', 'ffc700']));
      break;

    case 'dylan':
       params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

       params.append('facialHair', randomOption(['default']));

       params.append('facialHairProbability', randomOption(['10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('hair', randomOption(['bangs', 'buns', 'flatTop', 'fluffy', 'longCurls', 'parting', 'plain', 'roundBob', 'shaggy', 'shortCurls', 'spiky', 'wavy']));

       params.append('hairColor', randomOption(['000000', '1d5dff', 'ff543d', 'fff500', 'ffffff']));

       params.append('mood', randomOption(['angry', 'confused', 'happy', 'hopeful', 'neutral', 'sad', 'superHappy']));

       params.append('skinColor', randomOption(['c26450', 'ffd6c0']));
      break;

    case 'fun-emoji':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

       params.append('eyes', randomOption(['closed', 'closed2', 'crying', 'cute', 'glasses', 'love', 'pissed', 'plain', 'sad', 'shades', 'sleepClose', 'stars', 'tearDrop', 'wink', 'wink2']));

       params.append('mouth', randomOption(['cute', 'drip', 'faceMask', 'kissHeart', 'lilSmile', 'pissed', 'plain', 'sad', 'shout', 'shy', 'sick', 'smileLol', 'smileTeeth', 'tongueOut', 'wideSmile']));
      break;

      case 'glass':
      params.append('seed', randomOption(['Felix', 'Aneka']));
      params.append('flip', randomBoolean().toString());

       params.append('shape1', randomOption(['a', 'd', 'e', 'g', 'i', 'n', 'r', 't']));

       params.append('shape2', randomOption(['a', 'd', 'e', 'g', 'i', 'n', 'r', 't']));
      break;

      case 'icons':
       params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('icon', randomOption(['alarm', 'archive', 'award', 'bag', 'bandaid' , 'bank', 'basket', 'basket2', 'basket3', 'bell', 'bicycle', 'binoculars', 'book', 'bookshelf', 'boombox', 'box', 'boxes', 'boxSeam', 'bricks', 'briefcase', 'brightnessHigh', 'brush', 'bucket', 'bug', 'building', 'calculator', 'camera', 'cameraReels', 'cart2', 'cashCoin', 'clock', 'cloud', 'cloudDrizzle', 'cloudMoon', 'clouds', 'cloudSnow', 'coin', 'compass', 'controller', 'cup', 'cupStraw', 'dice5', 'disc', 'display', 'doorClosed', 'doorOpen', 'dpad', 'droplet', 'easel', 'egg', 'eggFried', 'emojiHeartEyes', 'emojiLaughing', 'emojiSmile', 'emojiSmileUpsideDown', 'emojiSunglasses', 'emojiWink', 'envelope', 'eyeglasses', 'flag', 'flower1', 'flower2', 'flower3', 'gem', 'gift', 'globe', 'globe2', 'handbag', 'handThumbsUp', 'hdd', 'heart', 'hourglass', 'hourglassSplit', 'house', 'houseDoor', 'inbox', 'inboxes', 'key', 'keyboard', 'ladder', 'lamp', 'laptop', 'lightbulb', 'lightning', 'lightningCharge', 'lock', 'magic', 'mailbox', 'map', 'megaphone', 'minecart', 'minecartLoaded', 'moon', 'moonStars', 'mortarboard', 'mouse', 'mouse2', 'newspaper', 'paintBucket', 'palette', 'palette2', 'paperclip', 'pen', 'pencil', 'phone', 'piggyBank', 'pinAngle', 'plug', 'printer', 'projector', 'puzzle', 'router', 'scissors', 'sdCard', 'search', 'send', 'shop', 'shopWindow', 'signpost', 'signpost2', 'signpostSplit', 'smartwatch', 'snow', 'snow2', 'snow3', 'speaker', 'star', 'stoplights', 'stopwatch', 'sun', 'tablet', 'thermometer', 'ticketPerforated', 'tornado', 'trash', 'trash2', 'tree', 'trophy', 'truck', 'truckFlatbed', 'tsunami', 'umbrella', 'wallet', 'wallet2', 'watch', 'webcam']));
      break;

      case 'identicon':
       params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('row1', randomOption(['ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx']));

       params.append('row2', randomOption(['ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx']));

       params.append('row3', randomOption(['ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx']));

       params.append('row4', randomOption(['ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx']));

       params.append('row5', randomOption(['ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx']));

       params.append('rowColor', randomOption(['00acc1', '1e88e5', '5e35b1', '6d4c41', '7cb342', '8e24aa', '039be5', '43a047', '546e7a', '00897b', '3949ab', '757575', 'c0ca33', 'd81b60', 'e53935', 'f4511e', 'fb8c00', 'fdd835', 'ffb300']));
      break;

      case 'initials':
       params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());
      break;

    case 'lorelei':
    case 'lorelei-neutral':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('beard', randomOption(['variant01', 'variant02']));

       params.append('beardProbability', randomOption(['10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('earrings', randomOption(['variant01', 'variant02', 'variant03']));

       params.append('earringsProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('eyebrows', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13']));

      params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24']));

      params.append('eyebrowsColor', randomOption(['0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3']));

      params.append('eyesColor', randomOption(['000000']));

      params.append('freckles', randomOption(['variant01']));

      params.append('frecklesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('glasses', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05']));

      params.append('glassesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('hair', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32', 'variant33', 'variant34', 'variant35', 'variant36', 'variant37', 'variant38', 'variant39', 'variant40', 'variant41', 'variant42', 'variant43', 'variant44', 'variant45', 'variant46', 'variant47', 'variant48']));

      params.append('hairColor', randomOption(['0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3']));

      params.append('hairAccessories', randomOption(['flowers']));

      params.append('hairAccessoriesColor', randomOption(['0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3']));

      params.append('hairAccessoriesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

      params.append('head', randomOption(['variant01', 'variant02', 'variant03', 'variant04']));

      params.append('mouth', randomOption(['happy01', 'happy02', 'happy03', 'happy04', 'happy05', 'happy06', 'happy07', 'happy08', 'happy09', 'happy10', 'happy11', 'happy12', 'happy13', 'happy14', 'happy15', 'happy16', 'happy17', 'happy18', 'sad01', 'sad02', 'sad03', 'sad04', 'sad05', 'sad06', 'sad07', 'sad08', 'sad09']));

      params.append('nose', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06']));
      break;

    case 'micah':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('baseColor', randomOption(['77311d', 'ac6651', 'f9c9b6']));

       params.append('earringColor', randomOption(['000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff']));

       params.append('earrings', randomOption(['hoop', 'stud']));

       params.append('earringsProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('ears', randomOption(['attached', 'detached']));

       params.append('eyeShadowColor', randomOption(['d2eff3', 'e0ddff', 'ffeba4', 'ffedef', 'ffffff']));

       params.append('eyebrows', randomOption(['down', 'eyelashesDown', 'eyelashesUp', 'up']));

       params.append('eyebrowsColor', randomOption(['0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3']));

       params.append('eyes', randomOption(['eyes', 'eyesShadow', 'round', 'smiling', 'smilingShadow']));

       params.append('eyesColor', randomOption(['091acd', 'e4e42b', '12bb1e', '53ecb8', 'e30952', 'a86524']));

       params.append('facialHair', randomOption(['scruff', 'beard']));

       params.append('facialHairColor', randomOption(['d2eff3', 'e0ddff', 'ffeba4', 'ffedef', 'ffffff']));

       params.append('facialHairProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('glasses', randomOption(['square', 'round']));

       params.append('glassesColor', randomOption(['000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff']));

       params.append('glassesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('hair', randomOption(['dannyPhantom', 'dougFunny', 'fonze', 'full', 'mrClean', 'mrT', 'pixie', 'turban']));

       params.append('hairColor', randomOption(['000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff']));

       params.append('hairProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('mouth', randomOption(['frown', 'laughing', 'nervous', 'pucker', 'sad', 'smile', 'smirk', 'surprised']));

       params.append('nose', randomOption(['curve' , 'pointed' , 'tound']));

       params.append('shirt', randomOption(['collared', 'crew', 'open']));

       params.append('shirtColor', randomOption(['000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff']));
      break;

    case 'miniavs':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('blushesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('body', randomOption(['golf', 'tShirt']));

       params.append('bodyColor', randomOption(['000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff']));

       params.append('eyes', randomOption(['confident', 'happy', 'normal']));

       params.append('glasses', randomOption(['normal']));

       params.append('glassesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('hair', randomOption(['balndess', 'classic01', 'classic02', 'curly', 'elvis', 'long', 'ponyTail', 'slaughter', 'stylish']));

       params.append('hairColor', randomOption(['000000', '1d5dff', 'ff543d', 'fff500', 'ffffff']));

       params.append('head', randomOption(['normal', 'thin', 'wide']));

       params.append('mouth', randomOption(['missingTooth', 'default']));

       params.append('mustache', randomOption(['freddy', 'horshoe', 'pencilThin', 'pencilThinBeard']));

       params.append('mustacheProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('skinColor', randomOption(['836055', 'f5d0c5', 'ffcb7e']));
      break;

    case 'notionists':
    case 'notionists-neutral':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('beard', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12']));

       params.append('beardProbability', randomOption(['20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('body', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25']));

       params.append('bodyIcon', randomOption(['electric', 'galaxy', 'saturn']));

       params.append('bodyIconProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('brows', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13']));

       params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05']));

       params.append('gesture', randomOption(['hand', 'handPhone', 'ok', 'okLongArm', 'point', 'pointLongArm', 'waveLongArm', 'waveLongArms', 'waveOkLongArms', 'wavePointLongArms']));

       params.append('gestureProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('glasses', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11']));

       params.append('glassesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('hair', randomOption(['hat', 'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32', 'variant33', 'variant34', 'variant35', 'variant36', 'variant37', 'variant38', 'variant39', 'variant40', 'variant41', 'variant42', 'variant43', 'variant44', 'variant45', 'variant46', 'variant47', 'variant48', 'variant49', 'variant50', 'variant51', 'variant52', 'variant53', 'variant54', 'variant55', 'variant56', 'variant57', 'variant58', 'variant59', 'variant60', 'variant61', 'variant62', 'variant63']));

       params.append('lips', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30']));

       params.append('nose', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20']));
      break;

    case 'open-peeps':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('accessories', randomOption(['eyepatch', 'glasses', 'glasses2', 'glasses3', 'glasses4', 'glasses5', 'sunglasses', 'sunglasses2']));

       params.append('accessoriesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('clothingColor', randomOption(['8fa7df', '9ddadb', '78e185', 'e279c7', 'e78276', 'fdea6b', 'ffcf77']));

       params.append('face', randomOption(['angryWithFang', 'awe', 'blank', 'calm', 'cheeky', 'concerned', 'concernedFear', 'contempt', 'cute', 'cyclops', 'driven', 'eatingHappy', 'explaining', 'eyesClosed', 'fear', 'hectic', 'lovingGrin1', 'lovingGrin2', 'monster', 'old', 'rage', 'serious', 'smile', 'smileBig', 'smileLOL', 'smileTeethGap', 'solemn', 'suspicious', 'tired', 'veryAngry']));

       params.append('facialHair', randomOption(['chin', 'full', 'full2', 'full3', 'full4', 'goatee1', 'goatee2', 'moustache1', 'moustache2', 'moustache3', 'moustache4', 'moustache5', 'moustache6', 'moustache7', 'moustache8', 'moustache9']));

       params.append('facialHairProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('head', randomOption(['afro', 'bangs', 'bangs2', 'bantuKnots', 'bear', 'bun', 'bun2', 'buns', 'cornrows', 'cornrows2', 'dreads1', 'dreads2', 'flatTop', 'flatTopLong', 'grayBun', 'grayMedium', 'grayShort', 'hatBeanie', 'hatHip', 'hijab', 'long', 'longAfro', 'longBangs', 'longCurly', 'medium1', 'medium2', 'medium3', 'mediumBangs', 'mediumBangs2', 'mediumBangs3', 'mediumStraight', 'mohawk', 'mohawk2', 'noHair1', 'noHair2', 'noHair3', 'pomp', 'shaved1', 'shaved2', 'shaved3', 'short1 ', 'short2', 'short3', 'short4', 'short5', 'turban', 'twists', 'twists2']));

       params.append('mask', randomOption(['respirator', 'medicalMask']));

       params.append('maskProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('skinColor', randomOption(['694d3d', 'ae5d29', 'd08b5b', 'edb98a', 'ffdbb4']));
      break;

    case 'personas':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('body', randomOption(['checkered', 'rounded', 'small', 'squared']));

       params.append('clothingColor', randomOption(['6dbb58', '54d7c7', '456dff', '7555ca', 'e24553', 'f3b63a', 'f55d81']));

       params.append('eyes', randomOption(['glasses', 'happy', 'open', 'sleep', 'sunglasses', 'wink']));

       params.append('facialHair', randomOption(['beardMustache', 'goatee', 'pyramid', 'shadow', 'soulPatch', 'walrus']));

       params.append('facialHairProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('hair', randomOption(['bald', 'balding', 'beanie', 'bobBangs', 'bobCut', 'bunUndercut', 'buzzcut', 'cap', 'curly', 'curlyBun', 'curlyHighTop', 'extraLong', 'fade', 'long', 'mohawk', 'pigtails', 'shortCombover', 'shortComboverChops', 'sideShave', 'straightBun']));

       params.append('hairColor', randomOption(['6c4545', '362c47', 'dee1f5', 'e15c66', 'e16381', 'f27d65', 'f29c65']));

       params.append('mouth', randomOption(['bigSmile', 'frown', 'lips', 'pacifier', 'smile', 'smirk', 'surprise']));

       params.append('nose', randomOption(['mediumRound', 'smallRound', 'wrinkles']));

       params.append('skinColor', randomOption(['623d36', '92594b', 'b16a5b', 'd78774', 'e5a07e', 'e7a391', 'eeb4a4']));
      break;

    case 'pixel-art':
    case 'pixel-art-neutral':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('accessories', randomOption(['variant01', 'variant02', 'variant03', 'variant04']));

       params.append('accessoriesColor', randomOption(['a9a9a9', 'd3d3d3', 'daa520', 'fafad2', 'ffd700']));

       params.append('accessoriesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('beard', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08']));

       params.append('beardProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('clothing', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23']));

       params.append('clothingColor', randomOption(['00b159', '5bc0de', '44c585', '88d8b0', '428bca', '03396c', 'ae0001', 'd11141', 'ff6f69', 'ffc425', 'ffd969', 'ffeead']));

       params.append('eyes', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12']));

       params.append('eyesColor', randomOption(['5b7c8b', '647b90', '697b94', '76778b', '588387', '876658']));

       params.append('glasses', randomOption(['dark01', 'dark02', 'dark03', 'dark04', 'dark05', 'dark06', 'dark07', 'light01', 'light02', 'light03', 'light04', 'light05', 'light06', 'light07']));

       params.append('glassesColor', randomOption(['4b4b4b', '5f705c', '43677d', '191919', '323232', 'a04b5d']));

       params.append('glassesProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('hair', randomOption(['long01', 'long02', 'long03', 'long04', 'long05', 'long06', 'long07', 'long08', 'long09', 'long10', 'long11', 'long12', 'long13', 'long14', 'long15', 'long17', 'long18', 'long19', 'long20', 'long21', 'short01', 'short02', 'short03', 'short04', 'short05', 'short06', 'short07', 'short08', 'short09', 'short10', 'short11', 'short12', 'short13', 'short14', 'short15', 'short16', 'short17', 'short18', 'short19',  'short20', 'short21', 'short22', 'short23', 'short24']));

       params.append('hairColor', randomOption(['009bbd', '91cb15', '603a14', '611c17', '28150a', '83623b', '603015', '612616', 'a78961', 'bd1700', 'cab188']));

       params.append('hat', randomOption(['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10']));

       params.append('hatColor', randomOption(['2e1e05', '3d8a6b', '614f8a', '2663a3', '989789', 'a62116', 'cc6192']));

       params.append('hatProbability', randomOption(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']));

       params.append('mouth', randomOption(['happy01', 'happy02', 'happy03', 'happy04', 'happy05', 'happy06', 'happy07', 'happy08', 'happy09', 'happy10', 'happy11', 'happy12', 'happy13', 'sad01', 'sad02', 'sad03', 'sad04', 'sad05', 'sad06', 'sad07', 'sad08', 'sad09', 'sad10']));

       params.append('mouthColor', randomOption(['c98276', 'd29985', 'de0f0d', 'e35d6a']));

       params.append('skinColor', randomOption(['8d5524', 'a26d3d', 'b68655', 'cb9e6e', 'e0b687', 'eac393', 'f5cfa0', 'ffdbac']));
      break;

    case 'rings':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('ringColor', randomOption(['4db6ac', '4dd0e1', '4fc3f7', '64b5f6', '81c784', '7986cb', '9575cd', 'aed581', 'ba68c8', 'dce775', 'e57373', 'f06292', 'ff8a65', 'ffb74d', 'ffd54f', 'fff176']));

       params.append('ringRotation', randomOption(['-180', '180']));

       params.append('ringFive', randomOption(['eighth', 'full', 'half', 'quarter']));

       params.append('ringFiveRotation', randomOption(['-180', '180']));

       params.append('ringFour', randomOption(['eighth', 'full', 'half', 'quarter']));

       params.append('ringFourRotation', randomOption(['-180', '180']));

       params.append('ringOne', randomOption(['eighth', 'full', 'half', 'quarter']));

       params.append('ringOneRotation', randomOption(['-180', '180']));

       params.append('ringThree', randomOption(['eighth', 'full', 'half', 'quarter']));

       params.append('ringThreeRotation', randomOption(['-180', '180']));

       params.append('ringTwo', randomOption(['eighth', 'full', 'half', 'quarter']));

       params.append('ringTwoRotation', randomOption(['-180', '180']));
      break;

    case 'shapes':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('shape1', randomOption(['ellipse', 'ellipseFilled', 'line', 'polygon', 'polygonFilled', 'rectangle', 'rectangleFilled']));

       params.append('shape1Color', randomOption(['0a5b83', '1c799f', '69d2e7', 'f1f4dc', 'f88c49']));

       params.append('shape1OffsetX', randomOption(['-65', '65']));

       params.append('shape1OffsetY', randomOption(['-45', '45']));

       params.append('shape1Rotation', randomOption(['-160', '160']));

       params.append('shape2', randomOption(['ellipse', 'ellipseFilled', 'line', 'polygon', 'polygonFilled', 'rectangle', 'rectangleFilled']));

       params.append('shape2Color', randomOption(['0a5b83', '1c799f', '69d2e7', 'f1f4dc', 'f88c49']));

       params.append('shape2OffsetX', randomOption(['-40', '40']));

       params.append('shape2OffsetY', randomOption(['-40', '40']));

       params.append('shape2Rotation', randomOption(['-180', '180']));

       params.append('shape3', randomOption(['ellipse', 'ellipseFilled', 'line', 'polygon', 'polygonFilled', 'rectangle', 'rectangleFilled']));

       params.append('shape3Color', randomOption(['0a5b83', '1c799f', '69d2e7', 'f1f4dc', 'f88c49']));

       params.append('shape3OffsetX', randomOption(['-25', '25']));

       params.append('shape3OffsetY', randomOption(['-25', '25']));

       params.append('shape3Rotation', randomOption(['-180', '180']));
      break;

    case 'thumbs':
      params.append('seed', randomOption(['Felix', 'Aneka']));
       params.append('flip', randomBoolean().toString());

       params.append('eyes', randomOption(['variant1W10', 'variant1W12', 'variant1W14', 'variant1W16', 'variant2W10', 'variant2W12', 'variant2W14', 'variant2W16', 'variant3W10', 'variant3W12', 'variant3W14', 'variant3W16', 'variant4W10', 'variant4W12', 'variant4W14', 'variant4W16', 'variant5W10', 'variant5W12', 'variant5W14', 'variant5W16', 'variant6W10', 'variant6W12', 'variant6W14', 'variant6W16', 'variant7W10', 'variant7W12', 'variant7W14', 'variant7W16', 'variant8W10', 'variant8W12', 'variant8W14', 'variant8W16', 'variant9W10', 'variant9W12', 'variant9W14', 'variant9W16']));

       params.append('eyesColor', randomOption(['091acd', 'e4e42b', '12bb1e', '53ecb8', 'e30952', 'a86524', 'ffffff', '000000']));

       params.append('face', randomOption(['variant1', 'variant2', 'variant3', 'variant4', 'variant5']));

       params.append('faceOffsetX', randomOption(['-15', '15']));

       params.append('faceOffsetY', randomOption(['-15', '15']));

       params.append('faceRotation', randomOption(['-20', '20']));

       params.append('mouth', randomOption(['variant1', 'variant2', 'variant3', 'variant4', 'variant5']));

       params.append('mouthColor', randomOption(['ffffff', '000000']));

       params.append('shape', randomOption(['default']));

       params.append('shapeColor', randomOption(['0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3']));

       params.append('shapeOffsetX', randomOption(['-5', '5']));

       params.append('shapeOffsetY', randomOption(['-5', '5']));

       params.append('shapeRotation', randomOption(['-20', '20']));
      break;

    default:
      params.append('flip', randomBoolean().toString());
      break;
  }
}

export function createDicebearParamsSection(style) {
  const paramsSection = document.createElement('div');
  paramsSection.className = 'dicebear-params-section';
  paramsSection.id = 'dicebearParamsSection';

  switch(style) {
    case 'adventurer':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('earrings', labels.avatarEarrings, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('earringsProbability', labels.avatarEarringsProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glasses', labels.avatarGlasses, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesProbability', labels.avatarGlassesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'long01', 'long02', 'long03', 'long04', 'long05', 'long06', 'long07', 'long08', 'long09', 'long10', 'long11', 'long12', 'long13', 'long14', 'long15', 'long17', 'long18', 'long19', 'long20', 'long21', 'long22', 'long23', 'long24', 'long25', 'long26', 'short01', 'short02', 'short03', 'short04', 'short05', 'short06', 'short07', 'short08', 'short09', 'short10', 'short11', 'short12', 'short13', 'short14', 'short15', 'short16', 'short17', 'short18', 'short19'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairProbability', labels.avatarHairProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '9e5622', '763900', 'ecad80', 'f2d3b1'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyebrows', labels.avatarEyebrows, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('features', labels.avatarFeatures, [
        'birthmark', 'blush', 'freckles', 'mustache'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('featuresProbability', labels.avatarFeaturesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      break;

    case 'adventurer-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('eyebrows', labels.avatarEyebrows, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glasses', labels.avatarGlasses, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesProbability', labels.avatarGlassesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30'
      ]));
      break;

    case 'avataaars':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('accessories', labels.avatarAccessories, [
        'eyepatch', 'kurt', 'prescription01', 'prescription02', 'round', 'sunglasses', 'wayfarers'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('accessoriesColor', labels.avatarAccessoriesColor, [
        '3c4f5c', '65c9ff', '262e33', '5199e4', '25557c', '929598', 'a7ffc4', 'b1e2ff', 'e6e6e6', 'ff5c5c', 'ff488e', 'ffafb9', 'ffdeb5', 'ffffb1', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('accessoriesProbability', labels.avatarAccessoriesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('clothesColor', labels.avatarClothesColor, [
        '3c4f5c', '65c9ff', '262e33', '5199e4', '25557c', '929598', 'a7ffc4', 'b1e2ff', 'e6e6e6', 'ff5c5c', 'ff488e', 'ffafb9', 'ffffb1', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('clothing', labels.avatarClothing, [
        'blazerAndShirt', 'blazerAndSweater', 'collarAndSweater', 'graphicShirt', 'hoodie', 'overall', 'shirtCrewNeck', 'shirtScoopNeck', 'shirtVNeck'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('clothingGraphic', labels.avatarClothingGraphic, [
        'bat', 'bear', 'cumbia', 'deer', 'diamond', 'hola', 'pizza', 'resist', 'skull', 'skullOutline'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyebrows', labels.avatarEyebrows, [
        'angry', 'angryNatural', 'default', 'defaultNatural', 'flatNatural', 'frownNatural', 'raisedExcited', 'raisedExcitedNatural', 'sadConcerned', 'sadConcernedNatural', 'unibrowNatural', 'upDown', 'upDownNatural'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'closed', 'cry', 'default', 'default', 'eyeRoll', 'happy', 'hearts', 'side', 'squint', 'surprised', 'wink', 'winkWacky', 'xDizzy'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHair', labels.avatarFacialHair, [
        'beardLight', 'beardMajestic', 'beardMedium', 'moustacheFancy', 'moustacheMagnum'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHairColor', labels.avatarFacialHairColor, [
        '2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'c93305', 'd6b370', 'e8e1e1', 'ecdcbf', 'f59797'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHairProbability', labels.avatarFacialHairProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'c93305', 'd6b370', 'e8e1e1', 'ecdcbf', 'f59797'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hatColor', labels.avatarHatColor, [
        '3c4f5c', '65c9ff', '262e33', '5199e4', '25557c', '929598', 'a7ffc4', 'b1e2ff', 'e6e6e6', 'ff5c5c', 'ff488e', 'ffafb9', 'ffdeb5', 'ffffb1', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'concerned', 'default', 'disbelief', 'eating', 'grimace', 'sad', 'screamOpen', 'serious', 'smile', 'tongue', 'twinkle', 'vomit'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '614335', 'ae5d29', 'd08b5b', 'edb98a', 'f8d25c', 'fd9841', 'ffdbb4'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('top', labels.avatarTop, [
        'bigHair', 'bob', 'bun', 'curly', 'curvy', 'dreads', 'dreads01', 'dreads02', 'frida', 'frizzle', 'fro', 'froBand', 'hat', 'hijab', 'longButNotTooLong', 'miaWallace', 'shaggy', 'shaggyMullet', 'shavedSides', 'shortCurly', 'shortFlat', 'shortRound', 'shortWaved', 'sides', 'straight01', 'straight02', 'straightAndStrand', 'theCaesar', 'theCaesarAndSidePart', 'turban', 'winterHat1', 'winterHat02', 'winterHat03', 'winterHat04'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('topProbability', labels.avatarTopProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      break;

    case 'avataaars-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('eyebrows', labels.avatarEyebrows, [
        'angry', 'angryNatural', 'default', 'defaultNatural', 'flatNatural', 'frownNatural', 'raisedExcited', 'raisedExcitedNatural', 'sadConcerned', 'sadConcernedNatural', 'unibrowNatural', 'upDown', 'upDownNatural'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'closed', 'cry', 'default', 'default', 'eyeRoll', 'happy', 'hearts', 'side', 'squint', 'surprised', 'wink', 'winkWacky', 'xDizzy'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'concerned', 'default', 'disbelief', 'eating', 'grimace', 'sad', 'screamOpen', 'serious', 'smile', 'tongue', 'twinkle', 'vomit'
      ]));
      break;

    case 'big-ears':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('cheek', labels.avatarCheek, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('cheekProbability', labels.avatarCheekProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ear', labels.avatarEar, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('face', labels.avatarFace, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('frontHair', labels.avatarFrontHair, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'long01', 'long02', 'long03', 'long04', 'long05', 'long06', 'long07', 'long08', 'long09', 'long10', 'long11', 'long12', 'long13', 'long14', 'long15', 'long17', 'long18', 'long19', 'long20', 'short01', 'short02', 'short03', 'short04', 'short05', 'short06', 'short07', 'short08', 'short09', 'short10', 'short11', 'short12', 'short13', 'short14', 'short15', 'short16', 'short17', 'short18', 'short19', 'short20'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'c93305', 'd6b370', 'e8e1e1', 'ecdcbf', 'f59797'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'variant0101', 'variant0102', 'variant0103', 'variant0104', 'variant0105', 'variant0201', 'variant0202', 'variant0203', 'variant0204', 'variant0205', 'variant0301', 'variant0302', 'variant0303', 'variant0304', 'variant0305', 'variant0401', 'variant0402', 'variant0403', 'variant0404', 'variant0405', 'variant0501', 'variant0502', 'variant0503', 'variant0504', 'variant0505', 'variant0601', 'variant0602', 'variant0603', 'variant0604', 'variant0605', 'variant0701', 'variant0702', 'variant0703', 'variant0704', 'variant0705', 'variant0706', 'variant0707', 'variant0708'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('nose', labels.avatarNose, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('sideburn', labels.avatarSideburn, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '89532c', 'a66637', 'c07f50', 'da9969', 'f8b788'
      ]));
      break;

    case 'big-ears-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('cheek', labels.avatarCheek, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('cheekProbability', labels.avatarCheekProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'variant0101', 'variant0102', 'variant0103', 'variant0104', 'variant0105', 'variant0201', 'variant0202', 'variant0203', 'variant0204', 'variant0205', 'variant0301', 'variant0302', 'variant0303', 'variant0304', 'variant0305', 'variant0401', 'variant0402', 'variant0403', 'variant0404', 'variant0405', 'variant0501', 'variant0502', 'variant0503', 'variant0504', 'variant0505', 'variant0601', 'variant0602', 'variant0603', 'variant0604', 'variant0605', 'variant0701', 'variant0702', 'variant0703', 'variant0704', 'variant0705', 'variant0706', 'variant0707', 'variant0708'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('nose', labels.avatarNose, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12'
      ]));
      break;

    case 'big-smile':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('accessories', labels.avatarAccessories, [
        'catEars', 'clownNose', 'faceMask', 'glasses', 'mustache', 'sailormoonCrown', 'sleepMask', 'sunglasses'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('accessoriesProbability', labels.avatarAccessoriesProbability, [
        '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'angry', 'cheery', 'confused', 'normal', 'sad', 'sleepy', 'starstruck', 'winking'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'bangs', 'bowlCutHair', 'braids', 'bunHair', 'curlyBob', 'curlyShortHair', 'froBun', 'halfShavedHead', 'mohawk', 'shavedHead', 'shortHair', 'straightHair', 'wavyBob'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '3a1a00', '220f00', '238d80', '605de4', '71472d', 'd56c0c', 'e2ba87', 'e9b729'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'awkwardSmile', 'braces', 'gapSmile', 'kawaii', 'openedSmile', 'openSad', 'teethSmile', 'unimpressed'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '8c5a2b', '643d19', 'a47539', 'c99c62', 'e2ba87', 'efcc9f', 'f5d7b1', 'ffe4c0'
      ]));
      break;

    case 'bottts':
    case 'bottts-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('baseColor', labels.avatarBaseColor, [
        '00acc1', '1e88e5', '5e35b1', '6d4c41', '7cb342', '8e24aa', '039be5', '43a047', '546e7a', '00897b', '3949ab', '757575', 'c0ca33', 'd81b60', 'e53935', 'f4511e', 'fb8c00', 'fdd835', 'ffb300'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'bulging', 'dizzy', 'eva', 'frame1', 'frame2', 'glow', 'happy', 'hearts', 'robocop', 'round', 'roundFrame01', 'roundFrame02', 'sensor', 'shade01'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('face', labels.avatarFace, [
        'square01', 'square02', 'square03', 'square04', 'round01', 'round02'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'bite', 'diagram', 'grill01', 'grill02', 'grill03', 'smile01', 'smile02', 'square01', 'square02'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouthProbability', labels.avatarMouthProbability, [
        '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('sides', labels.avatarSides, [
        'antenna01', 'antenna02', 'cables01', 'cables02', 'round', 'square', 'squareAssymetric'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('sidesProbability', labels.avatarSidesProbability, [
        '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('texture', labels.avatarTexture, [
        'camo01', 'camo02', 'circuits', 'dirty01', 'dirty02', 'dots', 'grunge01', 'grunge02'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('textureProbability', labels.avatarTextureProbability, [
        '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('top', labels.avatarTop, [
        'antenna', 'antennaCrooked', 'bulb01', 'glowingBulb01', 'glowingBulb02', 'horns', 'lights', 'pyramid', 'radar'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('topProbability', labels.avatarTopProbability, [
        '50', '60', '70', '80', '90', '100'
      ]));
      break;

    case 'croodles':
    case 'croodles-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('beard', labels.avatarBeard, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('beardProbability', labels.avatarBeardProbability, [
        '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('face', labels.avatarFace, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mustache', labels.avatarMustache, [
        'variant01', 'variant02', 'variant03', 'variant04'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mustacheProbability', labels.avatarMustacheProbability, [
        '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('nose', labels.avatarNose, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('top', labels.avatarTop, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('topColor', labels.avatarTopColor, [
        '000000', '0fa958', '699bf7', '9747ff', 'f24e1e', 'ffc700'
      ]));
      break;

    case 'dylan':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('facialHair', labels.avatarFacialHair, ['default']));
      paramsSection.appendChild(createDicebearParamSelect('facialHairProbability', labels.avatarFacialHairProbability, [
        '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'bangs', 'buns', 'flatTop', 'fluffy', 'longCurls', 'parting', 'plain', 'roundBob', 'shaggy', 'shortCurls', 'spiky', 'wavy'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '000000', '1d5dff', 'ff543d', 'fff500', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mood', labels.avatarMood, [
        'angry', 'confused', 'happy', 'hopeful', 'neutral', 'sad', 'superHappy'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        'c26450', 'ffd6c0'
      ]));
      break;

    case 'fun-emoji':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'closed', 'closed2', 'crying', 'cute', 'glasses', 'love', 'pissed', 'plain', 'sad', 'shades', 'sleepClose', 'stars', 'tearDrop', 'wink', 'wink2'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'cute', 'drip', 'faceMask', 'kissHeart', 'lilSmile', 'pissed', 'plain', 'sad', 'shout', 'shy', 'sick', 'smileLol', 'smileTeeth', 'tongueOut', 'wideSmile'
      ]));
      break;

    case 'glass':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('shape1', labels.avatarShape1, [
        'a', 'd', 'e', 'g', 'i', 'n', 'r', 't'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape2', labels.avatarShape2, [
        'a', 'd', 'e', 'g', 'i', 'n', 'r', 't'
      ]));
      break;

    case 'icons':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('icon', labels.avatarIcon, [
        'alarm', 'archive', 'award', 'bag', 'bandaid', 'bank', 'basket', 'basket2', 'basket3', 'bell', 'bicycle', 'binoculars', 'book', 'bookshelf', 'boombox', 'box', 'boxes', 'boxSeam', 'bricks', 'briefcase', 'brightnessHigh', 'brush', 'bucket', 'bug', 'building', 'calculator', 'camera', 'cameraReels', 'cart2', 'cashCoin', 'clock', 'cloud', 'cloudDrizzle', 'cloudMoon', 'clouds', 'cloudSnow', 'coin', 'compass', 'controller', 'cup', 'cupStraw', 'dice5', 'disc', 'display', 'doorClosed', 'doorOpen', 'dpad', 'droplet', 'easel', 'egg', 'eggFried', 'emojiHeartEyes', 'emojiLaughing', 'emojiSmile', 'emojiSmileUpsideDown', 'emojiSunglasses', 'emojiWink', 'envelope', 'eyeglasses', 'flag', 'flower1', 'flower2', 'flower3', 'gem', 'gift', 'globe', 'globe2', 'handbag', 'handThumbsUp', 'hdd', 'heart', 'hourglass', 'hourglassSplit', 'house', 'houseDoor', 'inbox', 'inboxes', 'key', 'keyboard', 'ladder', 'lamp', 'laptop', 'lightbulb', 'lightning', 'lightningCharge', 'lock', 'magic', 'mailbox', 'map', 'megaphone', 'minecart', 'minecartLoaded', 'moon', 'moonStars', 'mortarboard', 'mouse', 'mouse2', 'newspaper', 'paintBucket', 'palette', 'palette2', 'paperclip', 'pen', 'pencil', 'phone', 'piggyBank', 'pinAngle', 'plug', 'printer', 'projector', 'puzzle', 'router', 'scissors', 'sdCard', 'search', 'send', 'shop', 'shopWindow', 'signpost', 'signpost2', 'signpostSplit', 'smartwatch', 'snow', 'snow2', 'snow3', 'speaker', 'star', 'stoplights', 'stopwatch', 'sun', 'tablet', 'thermometer', 'ticketPerforated', 'tornado', 'trash', 'trash2', 'tree', 'trophy', 'truck', 'truckFlatbed', 'tsunami', 'umbrella', 'wallet', 'wallet2', 'watch', 'webcam'
      ]));
      break;

    case 'identicon':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('row1', labels.avatarRow1, [
        'ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('row2', labels.avatarRow2, [
        'ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('row3', labels.avatarRow3, [
        'ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('row4', labels.avatarRow4, [
        'ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('row5', labels.avatarRow5, [
        'ooxoo', 'oxoxo', 'oxxxo', 'xooox', 'xoxox', 'xxoxx', 'xxxxx'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('rowColor', labels.avatarRowColor, [
        '00acc1', '1e88e5', '5e35b1', '6d4c41', '7cb342', '8e24aa', '039be5', '43a047', '546e7a', '00897b', '3949ab', '757575', 'c0ca33', 'd81b60', 'e53935', 'f4511e', 'fb8c00', 'fdd835', 'ffb300'
      ]));
      break;

    case 'initials':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      break;

    case 'lorelei':
    case 'lorelei-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('beard', labels.avatarBeard, [
        'variant01', 'variant02'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('beardProbability', labels.avatarBeardProbability, [
        '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('earrings', labels.avatarEarrings, [
        'variant01', 'variant02', 'variant03'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('earringsProbability', labels.avatarEarringsProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyebrows', labels.avatarEyebrows, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyebrowsColor', labels.avatarEyebrowsColor, [
        '0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyesColor', labels.avatarEyesColor, [
        '000000'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('freckles', labels.avatarFreckles, [
        'variant01'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('frecklesProbability', labels.avatarFrecklesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glasses', labels.avatarGlasses, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesProbability', labels.avatarGlassesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32', 'variant33', 'variant34', 'variant35', 'variant36', 'variant37', 'variant38', 'variant39', 'variant40', 'variant41', 'variant42', 'variant43', 'variant44', 'variant45', 'variant46', 'variant47', 'variant48'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairAccessories', labels.avatarHairAccessories, [
        'flowers'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairAccessoriesColor', labels.avatarHairAccessoriesColor, [
        '0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairAccessoriesProbability', labels.avatarHairAccessoriesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('head', labels.avatarHead, [
        'variant01', 'variant02', 'variant03', 'variant04'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'happy01', 'happy02', 'happy03', 'happy04', 'happy05', 'happy06', 'happy07', 'happy08', 'happy09', 'happy10', 'happy11', 'happy12', 'happy13', 'happy14', 'happy15', 'happy16', 'happy17', 'happy18', 'sad01', 'sad02', 'sad03', 'sad04', 'sad05', 'sad06', 'sad07', 'sad08', 'sad09'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('nose', labels.avatarNose, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06'
      ]));
      break;

    case 'micah':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('baseColor', labels.avatarBaseColor, [
        '77311d', 'ac6651', 'f9c9b6'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('earringColor', labels.avatarEarringColor, [
        '000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('earrings', labels.avatarEarrings, [
        'hoop', 'stud'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('earringsProbability', labels.avatarEarringsProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ears', labels.avatarEars, [
        'attached', 'detached'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyeShadowColor', labels.avatarEyeShadowColor, [
        'd2eff3', 'e0ddff', 'ffeba4', 'ffedef', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyebrows', labels.avatarEyebrows, [
        'down', 'eyelashesDown', 'eyelashesUp', 'up'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyebrowsColor', labels.avatarEyebrowsColor, [
        '0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'eyes', 'eyesShadow', 'round', 'smiling', 'smilingShadow'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyesColor', labels.avatarEyesColor, [
        '091acd', 'e4e42b', '12bb1e', '53ecb8', 'e30952', 'a86524'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHair', labels.avatarFacialHair, [
        'scruff', 'beard'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHairColor', labels.avatarFacialHairColor, [
        'd2eff3', 'e0ddff', 'ffeba4', 'ffedef', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHairProbability', labels.avatarFacialHairProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glasses', labels.avatarGlasses, [
        'square', 'round'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesColor', labels.avatarGlassesColor, [
        '000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesProbability', labels.avatarGlassesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'dannyPhantom', 'dougFunny', 'fonze', 'full', 'mrClean', 'mrT', 'pixie', 'turban'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairProbability', labels.avatarHairProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'frown', 'laughing', 'nervous', 'pucker', 'sad', 'smile', 'smirk', 'surprised'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('nose', labels.avatarNose, [
        'curve', 'pointed', 'tound'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shirt', labels.avatarShirt, [
        'collared', 'crew', 'open'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shirtColor', labels.avatarShirtColor, [
        '000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff'
      ]));
      break;

    case 'miniavs':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('blushesProbability', labels.avatarBlushesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('body', labels.avatarBody, [
        'golf', 'tShirt'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('bodyColor', labels.avatarBodyColor, [
        '000000', '6bd9e9', '9287ff', '77311d', 'ac6651', 'd2eff3', 'e0ddff', 'f4d150', 'f9c9b6', 'fc909f', 'ffeba4', 'ffedef', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'confident', 'happy', 'normal'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glasses', labels.avatarGlasses, [
        'normal'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesProbability', labels.avatarGlassesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'balndess', 'classic01', 'classic02', 'curly', 'elvis', 'long', 'ponyTail', 'slaughter', 'stylish'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '000000', '1d5dff', 'ff543d', 'fff500', 'ffffff'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('head', labels.avatarHead, [
        'normal', 'thin', 'wide'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'missingTooth', 'default'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mustache', labels.avatarMustache, [
        'freddy', 'horshoe', 'pencilThin', 'pencilThinBeard'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mustacheProbability', labels.avatarMustacheProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '836055', 'f5d0c5', 'ffcb7e'
      ]));
      break;

    case 'notionists':
    case 'notionists-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('beard', labels.avatarBeard, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('beardProbability', labels.avatarBeardProbability, [
        '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('body', labels.avatarBody, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('bodyIcon', labels.avatarBodyIcon, [
        'electric', 'galaxy', 'saturn'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('bodyIconProbability', labels.avatarBodyIconProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('brows', labels.avatarBrows, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('gesture', labels.avatarGesture, [
        'hand', 'handPhone', 'ok', 'okLongArm', 'point', 'pointLongArm', 'waveLongArm', 'waveLongArms', 'waveOkLongArms', 'wavePointLongArms'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('gestureProbability', labels.avatarGestureProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glasses', labels.avatarGlasses, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesProbability', labels.avatarGlassesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'hat', 'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30', 'variant31', 'variant32', 'variant33', 'variant34', 'variant35', 'variant36', 'variant37', 'variant38', 'variant39', 'variant40', 'variant41', 'variant42', 'variant43', 'variant44', 'variant45', 'variant46', 'variant47', 'variant48', 'variant49', 'variant50', 'variant51', 'variant52', 'variant53', 'variant54', 'variant55', 'variant56', 'variant57', 'variant58', 'variant59', 'variant60', 'variant61', 'variant62', 'variant63'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('lips', labels.avatarLips, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23', 'variant24', 'variant25', 'variant26', 'variant27', 'variant28', 'variant29', 'variant30'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('nose', labels.avatarNose, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20'
      ]));
      break;

    case 'open-peeps':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('accessories', labels.avatarAccessories, [
        'eyepatch', 'glasses', 'glasses2', 'glasses3', 'glasses4', 'glasses5', 'sunglasses', 'sunglasses2'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('accessoriesProbability', labels.avatarAccessoriesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('clothingColor', labels.avatarClothesColor, [
        '8fa7df', '9ddadb', '78e185', 'e279c7', 'e78276', 'fdea6b', 'ffcf77'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('face', labels.avatarFace, [
        'angryWithFang', 'awe', 'blank', 'calm', 'cheeky', 'concerned', 'concernedFear', 'contempt', 'cute', 'cyclops', 'driven', 'eatingHappy', 'explaining', 'eyesClosed', 'fear', 'hectic', 'lovingGrin1', 'lovingGrin2', 'monster', 'old', 'rage', 'serious', 'smile', 'smileBig', 'smileLOL', 'smileTeethGap', 'solemn', 'suspicious', 'tired', 'veryAngry'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHair', labels.avatarFacialHair, [
        'chin', 'full', 'full2', 'full3', 'full4', 'goatee1', 'goatee2', 'moustache1', 'moustache2', 'moustache3', 'moustache4', 'moustache5', 'moustache6', 'moustache7', 'moustache8', 'moustache9'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHairProbability', labels.avatarFacialHairProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('head', labels.avatarHead, [
        'afro', 'bangs', 'bangs2', 'bantuKnots', 'bear', 'bun', 'bun2', 'buns', 'cornrows', 'cornrows2', 'dreads1', 'dreads2', 'flatTop', 'flatTopLong', 'grayBun', 'grayMedium', 'grayShort', 'hatBeanie', 'hatHip', 'hijab', 'long', 'longAfro', 'longBangs', 'longCurly', 'medium1', 'medium2', 'medium3', 'mediumBangs', 'mediumBangs2', 'mediumBangs3', 'mediumStraight', 'mohawk', 'mohawk2', 'noHair1', 'noHair2', 'noHair3', 'pomp', 'shaved1', 'shaved2', 'shaved3', 'short1', 'short2', 'short3', 'short4', 'short5', 'turban', 'twists', 'twists2'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mask', labels.avatarMask, [
        'respirator', 'medicalMask'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('maskProbability', labels.avatarMaskProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '694d3d', 'ae5d29', 'd08b5b', 'edb98a', 'ffdbb4'
      ]));
      break;

    case 'personas':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('body', labels.avatarBody, [
        'checkered', 'rounded', 'small', 'squared'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('clothingColor', labels.avatarClothesColor, [
        '6dbb58', '54d7c7', '456dff', '7555ca', 'e24553', 'f3b63a', 'f55d81'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'glasses', 'happy', 'open', 'sleep', 'sunglasses', 'wink'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHair', labels.avatarFacialHair, [
        'beardMustache', 'goatee', 'pyramid', 'shadow', 'soulPatch', 'walrus'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('facialHairProbability', labels.avatarFacialHairProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'bald', 'balding', 'beanie', 'bobBangs', 'bobCut', 'bunUndercut', 'buzzcut', 'cap', 'curly', 'curlyBun', 'curlyHighTop', 'extraLong', 'long', 'mohawk', 'pigtails', 'shortCombover', 'shortComboverChops', 'sideShave', 'straightBun'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '6c4545', '362c47', 'dee1f5', 'e15c66', 'e16381', 'f27d65', 'f29c65'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'bigSmile', 'frown', 'lips', 'pacifier', 'smile', 'smirk', 'surprise'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('nose', labels.avatarNose, [
        'mediumRound', 'smallRound', 'wrinkles'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '623d36', '92594b', 'b16a5b', 'd78774', 'e5a07e', 'e7a391', 'eeb4a4'
      ]));
      break;

    case 'pixel-art':
    case 'pixel-art-neutral':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('accessories', labels.avatarAccessories, [
        'variant01', 'variant02', 'variant03', 'variant04'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('accessoriesColor', labels.avatarAccessoriesColor, [
        'a9a9a9', 'd3d3d3', 'daa520', 'fafad2', 'ffd700'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('accessoriesProbability', labels.avatarAccessoriesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('beard', labels.avatarBeard, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('beardProbability', labels.avatarBeardProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('clothing', labels.avatarClothing, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12', 'variant13', 'variant14', 'variant15', 'variant16', 'variant17', 'variant18', 'variant19', 'variant20', 'variant21', 'variant22', 'variant23'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('clothingColor', labels.avatarClothesColor, [
        '00b159', '5bc0de', '44c585', '88d8b0', '428bca', '03396c', 'ae0001', 'd11141', 'ff6f69', 'ffc425', 'ffd969', 'ffeead'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10', 'variant11', 'variant12'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyesColor', labels.avatarEyesColor, [
        '5b7c8b', '647b90', '697b94', '76778b', '588387', '876658'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glasses', labels.avatarGlasses, [
        'dark01', 'dark02', 'dark03', 'dark04', 'dark05', 'dark06', 'dark07', 'light01', 'light02', 'light03', 'light04', 'light05', 'light06', 'light07'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesColor', labels.avatarGlassesColor, [
        '4b4b4b', '5f705c', '43677d', '191919', '323232', 'a04b5d'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('glassesProbability', labels.avatarGlassesProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hair', labels.avatarHair, [
        'long01', 'long02', 'long03', 'long04', 'long05', 'long06', 'long07', 'long08', 'long09', 'long10', 'long11', 'long12', 'long13', 'long14', 'long15', 'long17', 'long18', 'long19', 'long20', 'long21', 'short01', 'short02', 'short03', 'short04', 'short05', 'short06', 'short07', 'short08', 'short09', 'short10', 'short11', 'short12', 'short13', 'short14', 'short15', 'short16', 'short17', 'short18', 'short19', 'short20', 'short21', 'short22', 'short23', 'short24'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hairColor', labels.avatarHairColor, [
        '009bbd', '91cb15', '603a14', '611c17', '28150a', '83623b', '603015', '612616', 'a78961', 'bd1700', 'cab188'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hat', labels.avatarHat, [
        'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08', 'variant09', 'variant10'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hatColor', labels.avatarHatColor, [
        '2e1e05', '3d8a6b', '614f8a', '2663a3', '989789', 'a62116', 'cc6192'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('hatProbability', labels.avatarHatProbability, [
        '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'happy01', 'happy02', 'happy03', 'happy04', 'happy05', 'happy06', 'happy07', 'happy08', 'happy09', 'happy10', 'happy11', 'happy12', 'happy13', 'sad01', 'sad02', 'sad03', 'sad04', 'sad05', 'sad06', 'sad07', 'sad08', 'sad09', 'sad10'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouthColor', labels.avatarMouthColor, [
        'c98276', 'd29985', 'de0f0d', 'e35d6a'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('skinColor', labels.avatarSkinColor, [
        '8d5524', 'a26d3d', 'b68655', 'cb9e6e', 'e0b687', 'eac393', 'f5cfa0', 'ffdbac'
      ]));
      break;

    case 'rings':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('ringColor', labels.avatarRingColor, [
        '4db6ac', '4dd0e1', '4fc3f7', '64b5f6', '81c784', '7986cb', '9575cd', 'aed581', 'ba68c8', 'dce775', 'e57373', 'f06292', 'ff8a65', 'ffb74d', 'ffd54f', 'fff176'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringRotation', labels.avatarRingRotation, [
        '-180', '180'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringFive', labels.avatarRingFive, [
        'eighth', 'full', 'half', 'quarter'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringFiveRotation', labels.avatarRingFiveRotation, [
        '-180', '180'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringFour', labels.avatarRingFour, [
        'eighth', 'full', 'half', 'quarter'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringFourRotation', labels.avatarRingFourRotation, [
        '-180', '180'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringOne', labels.avatarRingOne, [
        'eighth', 'full', 'half', 'quarter'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringOneRotation', labels.avatarRingOneRotation, [
        '-180', '180'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringThree', labels.avatarRingThree, [
        'eighth', 'full', 'half', 'quarter'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringThreeRotation', labels.avatarRingThreeRotation, [
        '-180', '180'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringTwo', labels.avatarRingTwo, [
        'eighth', 'full', 'half', 'quarter'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('ringTwoRotation', labels.avatarRingTwoRotation, [
        '-180', '180'
      ]));
      break;

    case 'shapes':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('shape1', labels.avatarShape1, [
        'ellipse', 'ellipseFilled', 'line', 'polygon', 'polygonFilled', 'rectangle', 'rectangleFilled'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape1Color', labels.avatarShape1Color, [
        '0a5b83', '1c799f', '69d2e7', 'f1f4dc', 'f88c49'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape1OffsetX', labels.avatarShape1OffsetX, [
        '-65', '65'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape1OffsetY', labels.avatarShape1OffsetY, [
        '-45', '45'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape1Rotation', labels.avatarShape1Rotation, [
        '-160', '160'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape2', labels.avatarShape2, [
        'ellipse', 'ellipseFilled', 'line', 'polygon', 'polygonFilled', 'rectangle', 'rectangleFilled'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape2Color', labels.avatarShape2Color, [
        '0a5b83', '1c799f', '69d2e7', 'f1f4dc', 'f88c49'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape2OffsetX', labels.avatarShape2OffsetX, [
        '-40', '40'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape2OffsetY', labels.avatarShape2OffsetY, [
        '-40', '40'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape2Rotation', labels.avatarShape2Rotation, [
        '-180', '180'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape3', labels.avatarShape3, [
        'ellipse', 'ellipseFilled', 'line', 'polygon', 'polygonFilled', 'rectangle', 'rectangleFilled'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape3Color', labels.avatarShape3Color, [
        '0a5b83', '1c799f', '69d2e7', 'f1f4dc', 'f88c49'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape3OffsetX', labels.avatarShape3OffsetX, [
        '-25', '25'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape3OffsetY', labels.avatarShape3OffsetY, [
        '-25', '25'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape3Rotation', labels.avatarShape3Rotation, [
        '-180', '180'
      ]));
      break;

    case 'thumbs':
      paramsSection.appendChild(createDicebearParamSelect('seed', labels.avatarSeed, ['Felix', 'Aneka']));
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      paramsSection.appendChild(createDicebearParamSelect('eyes', labels.avatarEyes, [
        'variant1W10', 'variant1W12', 'variant1W14', 'variant1W16', 'variant2W10', 'variant2W12', 'variant2W14', 'variant2W16', 'variant3W10', 'variant3W12', 'variant3W14', 'variant3W16', 'variant4W10', 'variant4W12', 'variant4W14', 'variant4W16', 'variant5W10', 'variant5W12', 'variant5W14', 'variant5W16', 'variant6W10', 'variant6W12', 'variant6W14', 'variant6W16', 'variant7W10', 'variant7W12', 'variant7W14', 'variant7W16', 'variant8W10', 'variant8W12', 'variant8W14', 'variant8W16', 'variant9W10', 'variant9W12', 'variant9W14', 'variant9W16'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('eyesColor', labels.avatarEyesColor, [
        '091acd', 'e4e42b', '12bb1e', '53ecb8', 'e30952', 'a86524', 'ffffff', '000000'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('face', labels.avatarFace, [
        'variant1', 'variant2', 'variant3', 'variant4', 'variant5'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('faceOffsetX', labels.avatarFaceOffsetX, [
        '-15', '15'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('faceOffsetY', labels.avatarFaceOffsetY, [
        '-15', '15'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('faceRotation', labels.avatarFaceRotation, [
        '-20', '20'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouth', labels.avatarMouth, [
        'variant1', 'variant2', 'variant3', 'variant4', 'variant5'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('mouthColor', labels.avatarMouthColor, [
        'ffffff', '000000'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shape', labels.avatarShape, [
        'default'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shapeColor', labels.avatarShapeColor, [
        '0e0e0e', '3eac2c', '6a4e35', '85c2c6', '796a45', '562306', '592454', 'ab2a18', 'ac6511', 'afafaf', 'b9a05f', 'cb6820', 'dba3be', 'e5d7a3'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shapeOffsetX', labels.avatarShapeOffsetX, [
        '-5', '5'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shapeOffsetY', labels.avatarShapeOffsetY, [
        '-5', '5'
      ]));
      paramsSection.appendChild(createDicebearParamSelect('shapeRotation', labels.avatarShapeRotation, [
        '-20', '20'
      ]));
      break;

    default:
      paramsSection.appendChild(createDicebearParamSelect('flip', labels.avatarFlip, ['true', 'false']));
      break;
  }

  return paramsSection;
}

function createDicebearParamSelect(name, label, options, selectedValue) {
  const container = document.createElement('div');
  container.className = 'param-control';

  const selectId = `dicebearParams_${name}`;

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.htmlFor = selectId;

  const select = document.createElement('select');
  select.name = `dicebearParams.${name}`;
  select.id = selectId;

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    option.selected = opt === selectedValue;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    clearAvatarCache();
    applySettings(false);
  });

  container.appendChild(labelEl);
  container.appendChild(select);
  return container;
}
